/**
 * POST to an NDJSON endpoint and yield each line as a parsed object as soon as
 * it arrives.
 *
 *   for await (const event of streamNdjson('/api/classify', { prompt })) { ... }
 */
export async function* streamNdjson(url, body, { signal } = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    // A chunk can end mid-line: parse the complete lines, keep the remainder.
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) if (line.trim()) yield JSON.parse(line);
  }
  if (buffer.trim()) yield JSON.parse(buffer);
}
