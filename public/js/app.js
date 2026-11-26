/**
 * App entry point: load the data, draw the map, wire up the controls.
 */

import { createMap } from './map.js';
import { streamNdjson } from './stream.js';
import { answerFor } from './answer.js';

const EXAMPLE_PROMPTS = [
  'drives on the left',
  'is landlocked',
  'population over 50 million',
  'is in Europe',
  'official language is Spanish',
];

const [snapshot, topology] = await Promise.all([
  fetch('/api/countries').then((r) => r.json()),
  fetch('/vendor/countries-110m.json').then((r) => r.json()),
]);

const map = createMap(document.getElementById('map'), {
  topology,
  countries: snapshot.countries,
  tooltip: document.getElementById('tooltip'),
});
map.resetAll('idle');

// Example prompt chips fill the input.
const input = document.getElementById('prompt-input');
const chips = document.getElementById('example-chips');
for (const prompt of EXAMPLE_PROMPTS) {
  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'chip';
  chip.textContent = prompt;
  chip.addEventListener('click', () => {
    input.value = prompt;
    input.focus();
  });
  chips.append(chip);
}

// Run: stream Jev's answers onto the map as they arrive.
const runButton = document.getElementById('run-button');
const status = document.getElementById('run-status');

document.getElementById('prompt-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const prompt = input.value.trim();
  if (!prompt) return;

  runButton.disabled = true;
  status.classList.remove('error');
  map.resetAll('pending');
  const counts = { answered: 0, true: 0, unsure: 0, errors: 0 };

  try {
    for await (const event of streamNdjson('/api/classify', { prompt })) {
      if (event.type === 'start') {
        status.textContent = `Asking Jev about ${event.total} countries in ${event.batches} request(s)…`;
      } else if (event.type === 'result') {
        map.setResult(event.iso3, { status: 'done', probability: event.probability, latencyMs: event.latencyMs });
        counts.answered++;
        const answer = answerFor(event.probability);
        if (answer === 'true') counts.true++;
        if (answer === 'unsure') counts.unsure++;
      } else if (event.type === 'error') {
        map.setResult(event.iso3, { status: 'error', error: event.message });
        counts.errors++;
      } else if (event.type === 'done') {
        status.textContent =
          `${counts.answered}/${snapshot.count} answered · ${counts.true} true · ${counts.unsure} unsure · ` +
          `${counts.errors} errors · ${(event.wallMs / 1000).toFixed(1)} s · ` +
          `${event.inputTokens.toLocaleString()} input tokens · $${event.costUsd.toFixed(5)}`;
      }
    }
  } catch (error) {
    status.classList.add('error');
    status.textContent = `Run failed: ${error.message}`;
    map.resetAll('idle');
  } finally {
    runButton.disabled = false;
  }
});
