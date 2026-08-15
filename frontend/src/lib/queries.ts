// Page-level operations, written against the composed SDL.

export const LANDING = /* GraphQL */ `
  query Landing {
    tunes { id genre }
    works { id movements { id } }
  }
`;

// No server-side genre filter exists on Query.tunes today, so genre pages
// fetch the full set and filter here — fine at 411 tunes, revisit if that
// ever changes. Recording ids ride along for the per-tune counts.
export const GENRE_TUNES = /* GraphQL */ `
  query GenreTunes {
    tunes {
      id
      title
      genre
      style
      contrafactOf { id title }
      recordings { id }
    }
  }
`;

export const CLASSICAL_WORKS = /* GraphQL */ `
  query ClassicalWorks {
    works {
      id
      title
      catalogNumber
      composer { id name }
      movements { id }
    }
  }
`;

export const PALO_INDEX = /* GraphQL */ `
  query PaloIndex {
    tunes {
      id
      title
      genre
      palo
      recordings { id }
    }
  }
`;

export const PALO_DETAIL = /* GraphQL */ `
  query PaloDetail {
    tunes {
      id
      title
      genre
      palo
      recordings {
        id
        palo
        idiom
        source
        performers { id name }
        album { id title year }
      }
    }
  }
`;

export const TUNE_PAGE = /* GraphQL */ `
  query TunePage($id: ID!) {
    tune(id: $id) {
      id
      title
      style
      genre
      palo
      musicalKey
      composer { id name }
      contrafactOf { id title }
      contrafacts { id title }
      recordings {
        id
        performanceKey
        palo
        idiom
        source
        notes
        performers { id name }
        album { id title year }
      }
    }
  }
`;

// There is no movement(id:) root — movements resolve through the Piece
// entity interface, which is the point of the demo.
export const MOVEMENT_PAGE = /* GraphQL */ `
  query MovementPage($id: ID!) {
    piece(id: $id) {
      __typename
      id
      title
      genre
      musicalKey
      ... on Movement {
        position
        work {
          id
          title
          catalogNumber
          composer { id name }
        }
      }
      recordings {
        id
        performanceKey
        palo
        idiom
        source
        notes
        performers { id name }
        album { id title year }
      }
    }
  }
`;

export const WORK_PAGE = /* GraphQL */ `
  query WorkPage($id: ID!) {
    work(id: $id) {
      id
      title
      catalogNumber
      composer { id name }
      movements {
        id
        title
        position
        musicalKey
        recordings {
          id
          idiom
          source
          performers { id name }
          album { id title year }
        }
      }
    }
  }
`;

export const ALBUM_PAGE = /* GraphQL */ `
  query AlbumPage($id: ID!) {
    album(id: $id) {
      id
      title
      year
      label
      credits {
        artist { id name }
        role
      }
      tracks {
        id
        piece {
          __typename
          id
          title
          ... on Movement { work { id title } }
        }
        performers { id name }
      }
    }
  }
`;

export const ARTIST_PAGE = /* GraphQL */ `
  query ArtistPage($id: ID!) {
    artist(id: $id) {
      id
      name
      kind
      instruments
      styles
      bio
      members {
        member { id name }
        role
      }
      memberOf {
        group { id name }
        role
      }
      composedPieces {
        __typename
        id
        title
      }
      composedWorks { id title }
      recordings {
        id
        palo
        idiom
        source
        piece {
          __typename
          id
          title
          ... on Movement { work { id title } }
        }
        album { id title year }
      }
      albums {
        id
        title
        year
        tracks {
          id
          piece {
            __typename
            id
            title
            ... on Movement { work { id title } }
          }
        }
      }
    }
  }
`;

export const SEARCH_INDEX = /* GraphQL */ `
  query SearchIndex {
    tunes {
      id
      title
      genre
      recordings { id }
    }
    works {
      id
      title
      catalogNumber
      movements {
        id
        title
        recordings { id }
      }
    }
  }
`;
