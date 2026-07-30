/** Shapes of the JSON files the seeder emits into seed/. */

export interface Person {
  id: string;
  name: string;
  kind: "PERSON" | "ENSEMBLE";
  instruments: string[];
  styles: string[];
  bio: string | null;
  /** True for composers synthesized from tune/work frontmatter (no vault file of their own). */
  stub: boolean;
}

export interface Membership {
  groupId: string;
  memberId: string;
  role: string | null;
}

export type Genre = "CLASSICAL" | "JAZZ" | "FLAMENCO" | "BLUEGRASS";

export interface Work {
  id: string;
  title: string;
  catalogNumber: string | null;
  composerId: string | null;
  genre: Genre;
}

export interface Movement {
  id: string;
  workId: string;
  title: string;
  position: number | null;
  musicalKey: string | null;
  genre: Genre;
}

export interface Tune {
  id: string;
  title: string;
  composerId: string | null;
  style: string | null;
  contrafactOfId: string | null;
  musicalKey: string | null;
  /** Flamenco rhythmic form as written ('Rondeña'). Null for non-flamenco / untagged. */
  palo: string | null;
  genre: Genre;
}

export interface Credit {
  artistId: string;
  role: string | null;
}

export interface Album {
  id: string;
  title: string;
  year: number | null;
  label: string | null;
  /** Principal artists from frontmatter. Indexes Artist.albums and backs Album.leaders. */
  artistIds: string[];
  credits: Credit[];
  /** Recording ids on this album, in the album file's track order. */
  trackIds: string[];
}

export interface Recording {
  id: string;
  pieceId: string;
  albumId: string | null;
  performerIds: string[];
  performanceKey: string | null;
  /** Palo of this performance. Null when not noted. */
  palo: string | null;
  /** Idiom of this performance ('Classical', 'Jazz'). Null when untagged. */
  idiom: string | null;
  source: string | null;
  notes: string | null;
  bpm: number | null;
}
