import type { Genre, PieceRef } from './types';

export function genreLabel(g: Genre | string): string {
  const m: Record<string, string> = {
    JAZZ: 'Jazz',
    CLASSICAL: 'Classical',
    FLAMENCO: 'Flamenco',
    BLUEGRASS: 'Bluegrass',
  };
  return m[g] ?? g;
}

export const GENRE_SLUGS: Record<string, Genre> = {
  jazz: 'JAZZ',
  classical: 'CLASSICAL',
  flamenco: 'FLAMENCO',
  bluegrass: 'BLUEGRASS',
};

/** Two movements are both titled "Presto" (BWV 996 and BWV 1001), so a
 *  movement always renders as Work — Movement, never a bare title. */
export function pieceDisplay(p: PieceRef): string {
  if (p.__typename === 'Movement' && p.work) return `${p.work.title} — ${p.title}`;
  return p.title;
}

export function pieceHref(p: { __typename: 'Tune' | 'Movement'; id: string }): string {
  return p.__typename === 'Movement' ? `/movement/${p.id}` : `/tune/${p.id}`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
