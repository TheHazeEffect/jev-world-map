/**
 * The Jev integration: the only file that knows how to talk to Jev.
 *
 * Jev evaluates ONE `state` against MANY named questions in a single request.
 * We use that to batch: the state holds several countries' records, keyed by
 * ISO3, and there is one yes/no ("noul") question per country pointing at its
 * own record. One request, one response, one answer per country.
 *
 * Docs: https://developers.cloudflare.com/ai/models/typesafe/jev/
 */

const MODEL = 'typesafe/jev';

/**
 * The fields Jev sees for each country. Map-only fields (ccn3, lngLat) and
 * unMember (true for every record) are left out: they would only add tokens.
 */
export function toJevRecord({ ccn3, lngLat, unMember, ...record }) {
  return record;
}

/** Build the request input for a batch of countries and one prompt. */
export function buildInput(countries, prompt) {
  const state = {
    countries: Object.fromEntries(countries.map((c) => [c.iso3, toJevRecord(c)])),
  };

  // One noul (boolean) question per country, named by its ISO3 code.
  const questions = Object.fromEntries(
    countries.map((c) => [
      c.iso3,
      {
        type: 'noul',
        instructions: `Based on the data in \`countries.${c.iso3}\`, is the following true of ${c.name}: "${prompt}"`,
        criteria: {
          true: `The statement is true for ${c.name}`,
          false: `The statement is false for ${c.name}`,
        },
      },
    ]),
  );

  return { state, questions };
}

/**
 * Ask Jev about a batch of countries.
 *
 * @returns {Promise<{ probabilities: Record<string, number>, model: string,
 *                     inputTokens: number, outputTokens: number, latencyMs: number }>}
 */
export async function classifyBatch(countries, prompt, env, { signal } = {}) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/ai/run`;
  const started = Date.now();

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    // The REST API wraps Jev's { state, questions } in { model, input }.
    body: JSON.stringify({ model: MODEL, input: buildInput(countries, prompt) }),
    signal,
  });

  if (!res.ok) {
    const error = new Error(`Jev HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    error.status = res.status;
    error.retryAfter = res.headers.get('retry-after');
    throw error;
  }

  // The REST API wraps Jev's output twice:
  //   { success, result: { state: 'Completed', result: { model, answers, usage } } }
  const body = await res.json();
  const job = body.result;
  if (job?.state !== 'Completed' || !job.result?.answers) {
    throw new Error(`Unexpected Jev response: ${JSON.stringify(body).slice(0, 300)}`);
  }
  const output = job.result;

  // Each answer looks like { type: 'noul', noul: 0.97 }: `noul` is P(true).
  const probabilities = {};
  for (const [iso3, answer] of Object.entries(output.answers)) {
    probabilities[iso3] = answer.noul;
  }

  return {
    probabilities,
    model: output.model,
    inputTokens: output.usage.input_tokens,
    outputTokens: output.usage.output_tokens,
    latencyMs: Date.now() - started,
  };
}

/** Single-country convenience wrapper: a batch of one. */
export async function classify(country, prompt, env, options) {
  const { probabilities, ...rest } = await classifyBatch([country], prompt, env, options);
  return { probability: probabilities[country.iso3], ...rest };
}
