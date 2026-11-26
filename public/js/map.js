/**
 * The world map: D3 + Natural Earth 110m shapes (via the world-atlas package).
 *
 * world-atlas keys each shape by its ISO 3166-1 numeric code, so we join on the
 * snapshot's `ccn3`. The rest of the app speaks ISO3. 28 UN members (Monaco,
 * Singapore, Tuvalu, …) are too small for the 110m shapes, so we draw those as
 * dots at their coordinates instead.
 */

import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import { answerFor, trueOpacity } from './answer.js';

const WIDTH = 960;
const DOT_RADIUS = 3.5;
const PAD = DOT_RADIUS + 2; // Room around the map so edge dots aren't clipped.
const ANTARCTICA = '010';

/**
 * @param {HTMLElement} container
 * @param {{ topology: object, countries: object[], tooltip: HTMLElement }} options
 */
export function createMap(container, { topology, countries, tooltip }) {
  const byCcn3 = new Map(countries.map((c) => [c.ccn3, c]));
  const byIso3 = new Map(countries.map((c) => [c.iso3, c]));

  // Per-country result state: { status: 'idle' | 'pending' | 'done' | 'error', probability?, latencyMs?, error? }
  const results = new Map();

  const features = topojson
    .feature(topology, topology.objects.countries)
    .features.filter((f) => f.id !== ANTARCTICA);

  const projection = d3.geoEqualEarth().fitWidth(WIDTH, { type: 'FeatureCollection', features });
  const path = d3.geoPath(projection);
  const height = Math.ceil(path.bounds({ type: 'FeatureCollection', features })[1][1]);

  const svg = d3
    .select(container)
    .append('svg')
    .attr('viewBox', `${-PAD} ${-PAD} ${WIDTH + 2 * PAD} ${height + 2 * PAD}`)
    .attr('role', 'img')
    .attr('aria-label', 'World map coloured by Jev’s answers');

  // Diagonal hatch used for "unsure" answers. Its colours come from CSS classes.
  const hatch = svg
    .append('defs')
    .append('pattern')
    .attr('id', 'hatch')
    .attr('width', 6)
    .attr('height', 6)
    .attr('patternUnits', 'userSpaceOnUse')
    .attr('patternTransform', 'rotate(45)');
  hatch.append('rect').attr('class', 'hatch-bg').attr('width', 6).attr('height', 6);
  hatch.append('line').attr('class', 'hatch-line').attr('x1', 0).attr('y1', 0).attr('x2', 0).attr('y2', 6);

  // 1. Country shapes. Shapes with no UN member record (Taiwan, Kosovo, Western Sahara, …) are "no data".
  svg
    .append('g')
    .selectAll('path')
    .data(features)
    .join('path')
    .attr('d', path)
    .attr('class', (f) => (byCcn3.has(f.id) ? 'country' : 'country no-data'))
    .attr('data-iso3', (f) => byCcn3.get(f.id)?.iso3 ?? null)
    .attr('data-name', (f) => f.properties.name);

  // 2. Dots for UN members that have no 110m shape.
  const shapeIds = new Set(features.map((f) => f.id));
  const dotted = countries.filter((c) => !shapeIds.has(c.ccn3) && c.lngLat);
  svg
    .append('g')
    .selectAll('circle')
    .data(dotted)
    .join('circle')
    .attr('class', 'country dot')
    .attr('r', DOT_RADIUS)
    .attr('cx', (c) => projection(c.lngLat)[0])
    .attr('cy', (c) => projection(c.lngLat)[1])
    .attr('data-iso3', (c) => c.iso3);

  // ---- Tooltip -------------------------------------------------------------
  function tooltipHtml(el) {
    const iso3 = el.dataset.iso3;
    if (!iso3) {
      return `<strong>${el.dataset.name}</strong><span class="meta">Not a UN member: no data</span>`;
    }
    const country = byIso3.get(iso3);
    const r = results.get(iso3) ?? { status: 'idle' };
    let body;
    if (r.status === 'idle') body = 'Not asked yet';
    else if (r.status === 'pending') body = 'Waiting for Jev…';
    else if (r.status === 'error') body = `Error: ${r.error}`;
    else {
      body =
        `Answer: <b>${answerFor(r.probability)}</b><br>` +
        `<span class="meta">p = ${r.probability.toFixed(3)} · ${Math.round(r.latencyMs)} ms</span>`;
    }
    return `<strong>${country.name}</strong>${body}`;
  }

  function showTooltip(event) {
    tooltip.innerHTML = tooltipHtml(event.target);
    tooltip.hidden = false;
    // Keep the tooltip on screen near the pointer.
    const { innerWidth } = window;
    const box = tooltip.getBoundingClientRect();
    const x = Math.min(event.clientX + 14, innerWidth - box.width - 8);
    const y = event.clientY + 14;
    tooltip.style.left = `${Math.max(8, x)}px`;
    tooltip.style.top = `${y}px`;
  }

  svg
    .selectAll('.country')
    .on('pointerenter pointermove', showTooltip) // Works for mouse, and for tap on touch screens.
    .on('pointerleave', () => (tooltip.hidden = true));

  // ---- Public API ------------------------------------------------------------

  /** Re-draw one country from its current result state. */
  function paint(iso3) {
    const r = results.get(iso3) ?? { status: 'idle' };
    const answer = r.status === 'done' ? answerFor(r.probability) : null;
    svg
      .selectAll(`[data-iso3="${iso3}"]`)
      .classed('pending', r.status === 'pending')
      .classed('error', r.status === 'error')
      .classed('true', answer === 'true')
      .classed('false', answer === 'false')
      .classed('unsure', answer === 'unsure')
      .style('fill-opacity', answer === 'true' ? trueOpacity(r.probability) : null);
  }

  return {
    /** Set every country to the same status, e.g. 'pending' when a run starts. */
    resetAll(status = 'idle') {
      for (const c of countries) {
        results.set(c.iso3, { status });
        paint(c.iso3);
      }
    },
    /** Record the result for one country and repaint it. */
    setResult(iso3, result) {
      results.set(iso3, result);
      paint(iso3);
    },
  };
}
