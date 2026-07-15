/** Shapes of the JSON files the seeder emits into seed/. */

export interface InterpretiveProfile {
  clarity: string | null;
  toneColor: string | null;
  risk: string | null;
}

export interface Person {
  id: string;
  name: string;
  kind: "PERSON" | "ENSEMBLE";
  instruments: string[];
  styles: string[];
  bio: string | null;
  profile: InterpretiveProfile | null;
  /** True for composers synthesized from tune/work frontmatter (no vault file of their own). */
  stub: boolean;
}

export interface Membership {
  groupId: string;
  memberId: string;
  role: string | null;
}

export type Genre = "CLASSICAL" | "JAZZ" | "FLAMENCO";

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
  /** Principal artists from frontmatter. Used for indexing Artist.albums; not a schema field. */
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
  source: string | null;
  notes: string | null;
  bpm: number | null;
}
