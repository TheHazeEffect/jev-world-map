#!/usr/bin/env node
/**
 * Build data/countries.json: a snapshot of UN member states.
 *
 * Source: REST Countries v5 (https://restcountries.com/docs/countries).
 * v3.1 and older were shut down, and v5 needs a free API key:
 *
 *   REST_COUNTRIES_API_KEY=rc_live_... npm run build:countries
 *
 * The output is committed to the repo, so the app never needs network access
 * to REST Countries at runtime. Re-run this script only to refresh the data.
 */

import { writeFile, mkdir } from 'node:fs/promises';

const API_BASE = 'https://api.restcountries.com/countries/v5';
const OUTPUT_PATH = new URL('../data/countries.json', import.meta.url);
const PAGE_SIZE = 100; // Free-plan maximum.

// Only request the fields we use. v5 objects have 90+ fields, including
// large translation and leader branches we don't need.
const RESPONSE_FIELDS = [
  'codes.alpha_3',
  'codes.ccn3',
  'names.common',
  'region',
  'subregion',
  'population',
  'area.kilometers',
  'landlocked',
  'cars.driving_side',
  'languages',
  'currencies',
  'borders',
  'classification.un_member',
  'coordinates',
].join(',');

const apiKey = process.env.REST_COUNTRIES_API_KEY;
if (!apiKey) {
  console.error(
    'Missing REST_COUNTRIES_API_KEY. Sign up for a free key at https://restcountries.com/sign-up',
  );
  process.exit(1);
}

/** Fetch every UN member, following v5's limit/offset pagination. */
async function fetchUnMembers() {
  const all = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const url = new URL(API_BASE);
    url.searchParams.set('classification.un_member', 'true');
    url.searchParams.set('response_fields', RESPONSE_FIELDS);
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('offset', String(offset));

    const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) {
      throw new Error(`REST Countries ${res.status}: ${await res.text()}`);
    }
    const { data } = await res.json();

    // The public demo key returns a single sample object instead of real data.
    if (data?._demo) {
      throw new Error('Demo key detected. Use your own key from https://restcountries.com/sign-up');
    }

    all.push(...data.objects);
    if (!data.meta?.more) return all;
  }
}

/** Map a v5 country object to the flat record shape the app uses. */
function normalise(c) {
  return {
    iso3: c.codes.alpha_3,
    ccn3: c.codes.ccn3, // ISO numeric code: the key used by the world-atlas map shapes.
    name: c.names.common,
    region: c.region,
    subregion: c.subregion || null,
    population: c.population,
    areaKm2: c.area?.kilometers ?? null,
    landlocked: c.landlocked,
    drivingSide: c.cars?.driving_side ?? null,
    languages: (c.languages ?? []).map((l) => l.name),
    currencies: (c.currencies ?? []).map((cur) => ({ code: cur.code, name: cur.name })),
    borders: c.borders ?? [],
    unMember: c.classification?.un_member === true,
    // [longitude, latitude]: used to draw a dot for countries too small for the 110m map shapes.
    lngLat: c.coordinates ? [c.coordinates.lng, c.coordinates.lat] : null,
  };
}

const raw = await fetchUnMembers();
const countries = raw
  .map(normalise)
  .filter((c) => c.unMember) // Filter again locally in case the server-side filter changes.
  .sort((a, b) => a.name.localeCompare(b.name));

if (countries.length !== 193) {
  console.warn(`Warning: expected 193 UN members, got ${countries.length}.`);
}

const snapshot = {
  generatedAt: new Date().toISOString(),
  source: 'REST Countries v5 (https://restcountries.com)',
  count: countries.length,
  countries,
};

await mkdir(new URL('../data/', import.meta.url), { recursive: true });
await writeFile(OUTPUT_PATH, JSON.stringify(snapshot, null, 2) + '\n');
console.log(`Wrote ${countries.length} countries to data/countries.json`);
