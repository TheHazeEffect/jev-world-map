/**
 * One classification run: every country, one prompt, answers streamed back.
 *
 * Countries are split into batches of JEV_BATCH_SIZE (default: all of them in
 * a single Jev request). Batches run with a concurrency cap, a timeout per
 * call and retries with exponential backoff. As each batch finishes, its
 * answers are written to the response as NDJSON (one JSON object per line),
 * so the map can fill in without waiting for the whole run.
 */

import * as jev from './jev.js';
import * as mock from './mock.js';

/** Read numeric settings from wrangler.jsonc `vars`, with defaults. */
function settings(env, total) {
  const num = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback);
  return {
    batchSize: num(env.JEV_BATCH_SIZE, total), // 0 or unset = everything in one request
    concurrency: num(env.JEV_CONCURRENCY, 10),
    timeoutMs: num(env.JEV_TIMEOUT_MS, 60_000),
    maxRetries: num(env.JEV_MAX_RETRIES, 3),
  };
}

const chunk = (items, size) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Timeouts, rate limits (429) and server errors (5xx) are worth retrying. Bad requests (4xx) are not. */
function isRetryable(error) {
  return error.name === 'TimeoutError' || error.status === 429 || error.status >= 500 || error.status === undefined;
}

/** Call the provider, retrying with exponential backoff + jitter. Honours Retry-After. */
async function withRetries(call, { maxRetries, timeoutMs }) {
  for (let attempt = 1; ; attempt++) {
    try {
      return { ...(await call(AbortSignal.timeout(timeoutMs))), attempts: attempt };
    } catch (error) {
      if (attempt > maxRetries || !isRetryable(error)) {
        error.attempts = attempt;
        throw error;
      }
      const backoff = Number(error.retryAfter) * 1000 || 2 ** (attempt - 1) * 500 + Math.random() * 250;
      await sleep(backoff);
    }
  }
}

/** Run `task` over `items` with at most `limit` in flight at once. */
async function pool(items, limit, task) {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await task(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Start a run and return a streaming NDJSON Response.
 *
 * Lines: { type: 'start' } → { type: 'result' | 'error' } per country → { type: 'done' }
 */
export function classifyAll(countries, prompt, env, ctx) {
  const provider = env.MOCK_JEV === 'true' ? mock : jev;
  const mode = env.MOCK_JEV === 'true' ? 'mock' : 'jev';
  const config = settings(env, countries.length);
  const batches = chunk(countries, config.batchSize);
  const runId = crypto.randomUUID().slice(0, 8);

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const send = (obj) => writer.write(encoder.encode(JSON.stringify(obj) + '\n'));

  const run = async () => {
    const started = Date.now();
    const totals = { inputTokens: 0, outputTokens: 0, calls: 0, failedCalls: 0 };
    await send({ type: 'start', runId, mode, total: countries.length, batches: batches.length, batchSize: config.batchSize });

    await pool(batches, config.concurrency, async (batch) => {
      try {
        const r = await withRetries((signal) => provider.classifyBatch(batch, prompt, env, { signal }), config);
        totals.calls++;
        totals.inputTokens += r.inputTokens;
        totals.outputTokens += r.outputTokens;

        // Structured log, one line per Jev call. Part 2 reuses this shape for benchmarking.
        console.log(JSON.stringify({
          event: 'jev_call', runId, mode, model: r.model, prompt, countries: batch.length,
          latencyMs: r.latencyMs, inputTokens: r.inputTokens, outputTokens: r.outputTokens, attempts: r.attempts,
        }));

        for (const c of batch) {
          const probability = r.probabilities[c.iso3];
          console.log(JSON.stringify({ event: 'classify', runId, mode, prompt, iso3: c.iso3, probability, latencyMs: r.latencyMs }));
          await send(
            probability === undefined
              ? { type: 'error', iso3: c.iso3, message: 'No answer returned for this country' }
              : { type: 'result', iso3: c.iso3, probability, latencyMs: r.latencyMs, attempts: r.attempts },
          );
        }
      } catch (error) {
        totals.failedCalls++;
        console.log(JSON.stringify({ event: 'jev_call_failed', runId, mode, prompt, countries: batch.length, attempts: error.attempts, error: error.message }));
        for (const c of batch) await send({ type: 'error', iso3: c.iso3, message: error.message });
      }
    });

    const wallMs = Date.now() - started;
    const costUsd = (totals.inputTokens * 0.042) / 1e6; // $0.042 per 1M input tokens; output is free.
    console.log(JSON.stringify({ event: 'run_summary', runId, mode, prompt, wallMs, ...totals, costUsd }));
    await send({ type: 'done', wallMs, ...totals, costUsd });
    await writer.close();
  };

  // Keep the Worker alive until the run finishes, even after the response has started streaming.
  ctx.waitUntil(run().catch((error) => writer.abort(error)));

  return new Response(readable, {
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
