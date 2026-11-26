/**
 * Worker entry point.
 *
 *   GET  /api/countries  → the committed UN member snapshot
 *   POST /api/classify   → { prompt } in, NDJSON stream of Jev's answers out
 *
 * Everything else is a static file from ./public, served by Workers static assets
 * before this code even runs.
 */

import snapshot from '../data/countries.json';
import { classifyAll } from './run.js';

const MAX_PROMPT_LENGTH = 200;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/countries' && request.method === 'GET') {
      return Response.json(snapshot);
    }

    if (url.pathname === '/api/classify' && request.method === 'POST') {
      const { prompt } = await request.json().catch(() => ({}));
      const clean = typeof prompt === 'string' ? prompt.trim() : '';
      if (!clean || clean.length > MAX_PROMPT_LENGTH) {
        return Response.json({ error: `prompt must be 1–${MAX_PROMPT_LENGTH} characters` }, { status: 400 });
      }
      return classifyAll(snapshot.countries, clean, env, ctx);
    }

    return new Response('Not found', { status: 404 });
  },
};
