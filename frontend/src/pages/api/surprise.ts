import type { APIRoute } from 'astro';
import { gql } from '../../lib/api';
import { SEARCH_INDEX } from '../../lib/queries';

interface SearchData {
  tunes: { id: string; recordings: { id: string }[] }[];
  works: { movements: { id: string; recordings: { id: string }[] }[] }[];
}

// Lands on a random piece with at least five recordings, so it never drops
// you somewhere thin. For when someone else is driving the demo.
export const GET: APIRoute = async ({ redirect }) => {
  const data = await gql<SearchData>(SEARCH_INDEX);
  const candidates = [
    ...data.tunes.filter((t) => t.recordings.length >= 5).map((t) => `/tune/${t.id}`),
    ...data.works.flatMap((w) =>
      w.movements.filter((m) => m.recordings.length >= 5).map((m) => `/movement/${m.id}`),
    ),
  ];
  if (!candidates.length) return redirect('/', 302);
  return redirect(candidates[Math.floor(Math.random() * candidates.length)], 302);
};
