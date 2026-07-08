/** Shapes of the JSON files the seeder emits into seed/. */

export interface Person {
  id: string;
  name: string;
  instrument: string | null;
  type: "PERSON" | "ENSEMBLE";
  style: string | null;
}

export interface Tune {
  id: string;
  title: string;
  composer: string | null;
  composerId: string | null;
  style: string | null;
}

export interface Recording {
  id: string;
  tuneId: string;
  artistIds: string[];
  albumId: string | null;
  key: string | null;
  bpm: number | null;
  melody: string | null;
}

export interface Credit {
  artistId: string;
  instrument: string | null;
}

export interface Album {
  id: string;
  title: string;
  year: number | null;
  recordingYear: number | null;
  label: string | null;
  artistIds: string[];
  credits: Credit[];
  tracks: { tuneId: string; key: string | null }[];
}

export interface Work {
  bwv: number;
  title: string;
}

export interface Movement {
  id: string;
  bwv: number;
  name: string;
  key: string | null;
  order: number;
}

export interface MovementRecording {
  id: string;
  movementId: string;
  performerId: string;
  label: string | null;
  character: string | null;
  notes: string | null;
  bpm: number | null;
}
