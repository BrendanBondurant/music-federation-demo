import type { APIRoute } from 'astro';
import { gql } from '../../lib/api';
import { SEARCH_INDEX } from '../../lib/queries';

interface SearchData {
  tunes: { id: string; title: string; genre: string; recordings: { id: string }[] }[];
  works: {
    id: string;
    title: string;
    catalogNumber: string | null;
    movements: { id: string; title: string; recordings: { id: string }[] }[];
  }[];
}

// Title → href index for the header search. Movements are listed as
// "Work — Movement": two movements share the bare title "Presto".
export const GET: APIRoute = async () => {
  const data = await gql<SearchData>(SEARCH_INDEX);
  const index = [
    ...data.tunes.map((t) => ({
      title: t.title,
      kind: 'tune',
      href: `/tune/${t.id}`,
      n: t.recordings.length,
    })),
    ...data.works.map((w) => ({
      title: w.catalogNumber && w.catalogNumber !== w.title ? `${w.title} (${w.catalogNumber})` : w.title,
      kind: 'work',
      href: `/work/${w.id}`,
      n: w.movements.length,
    })),
    ...data.works.flatMap((w) =>
      w.movements.map((m) => ({
        title: `${w.title} — ${m.title}`,
        kind: 'movement',
        href: `/movement/${m.id}`,
        n: m.recordings.length,
      })),
    ),
  ];
  return new Response(JSON.stringify(index), {
    headers: { 'content-type': 'application/json' },
  });
};
