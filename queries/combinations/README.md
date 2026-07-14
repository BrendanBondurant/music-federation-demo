# Subgraph combination queries

One query per non-empty combination of the three subgraphs, so every way the
router can (or can't) fan out is covered. Run each against the composed router
and check the query plan to confirm exactly the listed subgraphs are fetched.

Subgraphs: **A** = artists (:4001) · **C** = catalog (:4002) · **L** = classical (:4003)

| # | File | A | C | L | Join / entry point |
|---|------|---|---|---|--------------------|
| 1 | `1-artists.graphql` | ✅ | | | `artist(id)` identity only |
| 2 | `2-catalog.graphql` | | ✅ | | `tune`/`album` + tracks, catalog-owned fields only |
| 3 | `3-classical.graphql` | | | ✅ | `work(id)` → movements → recordings, no performer name |
| 4 | `4-artists-catalog.graphql` | ✅ | ✅ | | Artist @key: identity + discography |
| 5 | `5-artists-classical.graphql` | ✅ | | ✅ | Artist @key: identity + bachRecordings |
| 6 | `6-catalog-classical.graphql` | | ✅ | ✅ | Tune @key: jazz edge + classical edge (no names) |
| 7 | `7-artists-catalog-classical.graphql` | ✅ | ✅ | ✅ | Tune @key + Artist @key: full crossover |

Which subgraphs a query hits is decided by the **fields selected**, not the root:
the single-subgraph queries (2, 3, 6) deliberately avoid selecting any field
owned by another subgraph. Add an artist `name` to query 6, for example, and it
becomes an A+C+L query (that is query 7).
