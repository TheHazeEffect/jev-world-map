/**
 * Mock Jev (MOCK_JEV=true): same interface as jev.js, no network, no credentials.
 *
 * Probabilities are fake but stable: the same country + prompt always gets the
 * same answer, so screenshots are repeatable. Most answers land near 0 or 1,
 * with some in the "unsure" middle band, roughly like real calibrated output.
 */

import { buildInput } from './jev.js';

const FAILURE_RATE = 0.03; // Occasional failures exercise the retry logic.

/** Small deterministic hash → number in [0, 1). */
function seededRandom(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 2 ** 32;
}

function fakeProbability(iso3, prompt) {
  const r = seededRandom(`${iso3}|${prompt.toLowerCase()}`);
  if (r < 0.1) return 0.35 + seededRandom(`${iso3}|u`) * 0.3; // ~10% unsure
  const confident = 0.8 + seededRandom(`${iso3}|c`) * 0.2;
  return r < 0.4 ? confident : 1 - confident; // ~30% true, ~60% false
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });

export async function classifyBatch(countries, prompt, env, { signal } = {}) {
  const started = Date.now();
  await sleep(150 + Math.random() * 750, signal);

  if (Math.random() < FAILURE_RATE) {
    const error = new Error('Mock Jev: simulated 503');
    error.status = 503;
    throw error;
  }

  const probabilities = Object.fromEntries(
    countries.map((c) => [c.iso3, fakeProbability(c.iso3, prompt)]),
  );

  // Rough token estimate: ~4 characters per token of the real request input.
  const inputTokens = Math.round(JSON.stringify(buildInput(countries, prompt)).length / 4);

  return {
    probabilities,
    model: 'mock-jev',
    inputTokens,
    outputTokens: countries.length * 8,
    latencyMs: Date.now() - started,
  };
}
