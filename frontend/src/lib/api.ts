// Plain-fetch GraphQL client for the Cosmo Router. No Apollo packages,
// matching the rest of this repo: federation with nothing but the spec.

export const GRAPHQL_ENDPOINT =
  import.meta.env.GRAPHQL_ENDPOINT ?? 'http://localhost:3002/graphql';

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string; path?: (string | number)[] }[];
}

export async function gql<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
  } catch (cause) {
    throw new Error(
      `Could not reach the Cosmo Router at ${GRAPHQL_ENDPOINT}. ` +
        `Boot the backend first: npm start in the repo root.`,
      { cause },
    );
  }
  const body = (await res.json()) as GraphQLResponse<T>;
  if (body.errors?.length) {
    throw new Error(
      `GraphQL error from the router: ${body.errors.map((e) => e.message).join('; ')}`,
    );
  }
  if (!body.data) throw new Error('GraphQL response had no data.');
  return body.data;
}
