import type { APIRoute } from 'astro';
import { GRAPHQL_ENDPOINT } from '../../lib/api';

// Same-origin proxy to the Cosmo Router for browser-side calls (the
// query-view drawer). Forwards the query-plan header so the drawer can show
// the router's real plan; avoids caring about the router's CORS config.
export const POST: APIRoute = async ({ request }) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const plan = request.headers.get('x-wg-include-query-plan');
  if (plan) headers['x-wg-include-query-plan'] = plan;

  const upstream = await fetch(GRAPHQL_ENDPOINT, {
    method: 'POST',
    headers,
    body: await request.text(),
  }).catch(() => null);

  if (!upstream) {
    return new Response(
      JSON.stringify({ errors: [{ message: `Router unreachable at ${GRAPHQL_ENDPOINT}` }] }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    );
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { 'content-type': 'application/json' },
  });
};
