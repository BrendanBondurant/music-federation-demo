// Shapes of the composed graph as this frontend selects them. Hand-written
// against the three schema.graphql files (the public contract) — nullability
// mirrors the SDL, because nulls are real in this data.

export type Genre = 'CLASSICAL' | 'JAZZ' | 'FLAMENCO' | 'BLUEGRASS';

export interface ArtistRef {
  id: string;
  name: string;
}

export interface AlbumRef {
  id: string;
  title: string;
  year: number | null;
}

export interface PieceRef {
  __typename: 'Tune' | 'Movement';
  id: string;
  title: string;
  work?: { id: string; title: string } | null; // present on Movement selections
}

export interface RecordingRow {
  id: string;
  performanceKey?: string | null;
  palo?: string | null;
  idiom?: string | null;
  source?: string | null;
  notes?: string | null;
  performers: ArtistRef[];
  album: AlbumRef | null;
  piece?: PieceRef;
}

export interface TuneCard {
  id: string;
  title: string;
  genre: Genre;
  style?: string | null;
  palo?: string | null;
  contrafactOf?: { id: string; title: string } | null;
  recordings: { id: string }[];
}
