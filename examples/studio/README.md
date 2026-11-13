# drizzler studio example

Two Drizzle schemas to try `drizzler studio` on:

- [sqlite/schema.ts](sqlite/schema.ts) — a small blog (users, posts, comments, tags and a
  composite-key join table) with a seeded SQLite database, so every page of the studio works,
  rows, Drizzle queries and SQL included.
- [db/schema.ts](db/schema.ts) — a PostgreSQL schema that uses everything the ER diagram draws:
  a `pgEnum`, a composite primary key, unique and plain indexes, `foreignKey()` and
  `.references()` with `onDelete` / `onUpdate`, a self reference, an array column, defaults,
  `///` descriptions in Japanese, and a relation declared only by `defineRelations` (dashed).

## Try the studio

From the repository root:

```sh
pnpm install
pnpm studio            # sqlite/schema.ts with sqlite/dev.db: every page
pnpm studio:diagram    # db/schema.ts without a database: Schema and Docs
```

Both build drizzler and open <http://127.0.0.1:4983>. In a Dev Container or Codespace, open the
forwarded port 4983 from the **Ports** tab. Stop the server with Ctrl+C.

`pnpm studio` creates `sqlite/dev.db` the first time (Node.js 22.13 or newer, for `node:sqlite`):
[sqlite/seed.mjs](sqlite/seed.mjs) creates the tables and `drizzler seed` fills them with the rows of
[drizzler.config.ts](drizzler.config.ts), nested under their parents with no id written by hand.
Then:

- **Schema** — edit the schema; the diagram redraws as you type. Type `.` after
  `text("name")` for drizzle-orm's column methods, or misspell `.notNull()` to see a type error.
  Ctrl/Cmd + S saves, **Format** runs oxfmt, **SVG** / **PNG** download the diagram.
- **Docs** — the tables, columns, relations and enums, with the `///` descriptions.
- **Query** — Drizzle against the database, e.g.
  `db.query.post.findMany({ with: { author: true } })`, then Ctrl/Cmd + Enter.
- **user**, **post**, ... in the sidebar — the rows; add, edit and delete them.
- **SQL** — e.g. `SELECT * FROM posts WHERE published = 1`, then Ctrl/Cmd + Enter.

Put everything back with `pnpm -F @examples/studio reset` (the schemas from git, and a fresh
`sqlite/dev.db`); `pnpm -F @examples/studio seed` only rebuilds the database. To fill it with
made-up rows instead, give a table a `count` in `drizzler.config.ts` in place of its `data`, e.g.
`comment: { count: 50 }`.

See [the studio guide](../../packages/drizzler/docs/studio.md) for everything it does.

## Generate the files

```sh
pnpm example   # from the repository root
```

writes [docs/](docs) from `db/schema.ts`: `er.svg`, `er.png`, `er-dark.png`, `ER.md` (Mermaid)
and `schema.dbml`.

![ER diagram](docs/er.png)
