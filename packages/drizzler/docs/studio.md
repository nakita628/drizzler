# drizzler studio

A local web app for a Drizzle schema: edit it in Monaco with its ER diagram beside it, read its
generated docs, run Drizzle queries, and browse and edit the rows of the database it describes.

```sh
npx drizzler studio db/schema.ts
npx drizzler studio db/schema.ts --url file:./dev.db
npx drizzler studio db/schema.ts --url postgres://user:pass@localhost:5432/app --port 5000
```

| Option                     | Default         | What it does                                                             |
| -------------------------- | --------------- | ------------------------------------------------------------------------ |
| `-u, --url <database-url>` | `$DATABASE_URL` | The database the table, **Query** and **SQL** pages work on. Optional.   |
| `-p, --port <port>`        | `4983`          | The port to listen on (1–65535). The server answers on `127.0.0.1` only. |

Stop the server with **Ctrl+C**; the database connection is closed with it.

## Pages

### Schema

The saved schema's ER diagram across the page: a canvas of cards, one per table and enum, drawn
with [React Flow](https://reactflow.dev/), redrawn when the file changes on disk. The header counts
the tables, relations and enums; **Show in diagram** on a table's page fits the canvas to it.

- Cards can be dragged; where you leave them is remembered in the browser for that schema file,
  and shared with the diagrams of the other pages. **Auto layout** lays them out again. A new
  table is placed by the layout; one that left the schema is forgotten.
- Clicking a card selects it and picks out its relations. The arrow on a card opens the table's
  or the enum's page.
- An edge is a foreign key (`.references()` or `foreignKey()`), drawn solid, or a relation only
  `defineRelations` declares, drawn dashed, since nothing in the database enforces it.
- **SVG** / **PNG** download the diagram as it is laid out on the canvas, in the current theme.
- Drag the background to pan, scroll to zoom, and use the controls and the minimap in the corners.

### Drizzle schema

The schema file in [Monaco](https://microsoft.github.io/monaco-editor/) on the left and its ER
diagram on the right, redrawn about a quarter of a second after you stop typing — unsaved text
included. The card of the table the cursor is in is selected, and the relations it takes part in
are picked out. A table's page (**Drizzle schema**) opens the editor on its declaration, and the
error banner of the other pages on the line of the error.

- A syntax error is underlined in the editor and named under the diagram, with its line and
  column; click it to jump there. The last diagram that parsed stays on screen meanwhile.
- **Save** (Ctrl/Cmd + S) writes the file. A change made by another editor is picked up: a clean
  editor takes it at once, and with unsaved edits a banner asks whether to load the file or keep
  your edits.
- **Format** (Shift + Alt + F, or _Format Document_ in the context menu) runs
  [oxfmt](https://oxc.rs/docs/guide/usage/formatter) on the server, the way `oxfmt` formats the
  project: with its `.oxfmtrc.json` (or `.oxfmtrc.jsonc`) when it has one, oxfmt's defaults when
  not. The studio has no formatter settings of its own, and never writes that file.
- The divider between the panes can be dragged, or moved with the arrow keys.

#### Completion and type errors

The editor asks the project's own TypeScript about the schema, through the server, so it knows
drizzle-orm's types as they are installed:

- **Completion** of what is there to write: the builders an import offers (`varchar`,
  `integer`, `pgEnum`, ...), the column methods after a `.` (`.notNull()`, `.default()`,
  `.references()`, ...), object keys and the tables of the file. The highlighted item shows its
  type and documentation.
- **Signature help** inside a call, with the parameter you are on.
- **Hover** over a name for its type.
- **Type errors** under a squiggle about half a second after you stop typing: `.notNul()` is
  `Property 'notNul' does not exist ... Did you mean 'notNull'?`. While the file has a syntax
  error, only that one is shown.

The header says which TypeScript is in use (**TS 6.0.3**). The schema is checked as part of the
project: with the compiler options of the nearest `tsconfig.json`, and with its imports — other
files of the schema, drizzle-orm — resolved from the schema's directory as the project resolves
them. Unsaved text is what is checked.

This needs `typescript` 5.x or 6.x installed in the project (`npm install -D typescript`).
TypeScript 7 has no language service API yet. Without one, the header says **No TypeScript**
(hover it for why) and the editor keeps its colouring and the parser's syntax errors.

### Docs

The documentation of the saved file, generated from the schema and the comments above its tables,
columns and enums (`/** … */` or `//`):

- every table with its database name and description;
- each column's type, `PK` / `UNIQUE` / `NOT NULL`, its defaults (`.default()`, `.defaultNow()`,
  `$defaultFn()`, ...), its description and the column it references;
- indexes, unique and composite keys;
- relations in both directions (**References** and **Referenced by**), with their cardinality and
  `onDelete` / `onUpdate` actions. A relation declared only by `defineRelations` is marked, since
  no foreign key backs it;
- every `pgEnum` and its values;
- Drizzle queries to start from for each table, with nothing to fill in: **Select**
  (`db.select().from(post)`), **Count** (`db.$count(post)`), **Find many**
  (`db.query.post.findMany()`) and, for a table with relations, **With relations**
  (`db.query.post.findMany({ with: { author: true } })`). **Open in Query** puts one in the Query
  page's editor.

### Tables and enums

One page per table of the schema, listed in the sidebar with its row count, with two tabs:

- **Data** — the rows, 100 at a time, ordered by the key. The search box (focus it with `/`)
  finds the rows where any column holds the text, whatever its case; what matched is marked.
  - A value is picked by a click; **Enter** or its pencil edits it in place (a list for an enum
    or a boolean), **⌘/Ctrl + C** or its copy button copies it.
  - **Add row** puts an empty row on top. Fields left empty are not sent, so the database fills
    them in from its defaults; a nullable column takes `NULL`.
  - Tick rows to copy them (as a spreadsheet pastes them) or delete them, after asking. Each
    row's menu copies it, as TSV or JSON, or deletes it.
  - **Export** downloads the page as CSV or JSON, or copies it. **Columns** folds columns away
    (remembered per table); copies and exports take what is shown.
- **Columns** — the columns as the schema declares them: type, key, uniqueness, defaults, the
  column a foreign key references, and the description from its comment.

The details panel beside either (the **i** button) lists the columns, the relations to and from
the table and its indexes. An enum's page lists its values and the columns that hold it.

A row is identified by its primary key — a composite one included — or, without one, by its
unique columns, or else by all of its columns. Columns are written by their database names
(`author_id`), while the page shows the schema's property names (`authorId`).

### Query

Drizzle against the connected database. Write a query, run it with **Ctrl/Cmd + Enter**, and see
its value and every statement it sent:

```ts
db.select().from(post).where(eq(post.published, true)).orderBy(desc(post.id));
```

```ts
db.query.post.findMany({ with: { author: true }, limit: 10 });
```

```ts
const [added] = await db.insert(tag).values({ name: "drizzle" }).returning();
return { added, total: await db.$count(tag) };
```

- `db` is Drizzle over the studio's own connection, with the schema's `defineRelations` (and any
  `defineRelationsPart`) exports, so the relational API (`db.query.*`, relations v2) works on every
  table: `db.query.post.findFirst({ where: { id: 1 }, with: { author: true } })`. The schema's exports (tables, relations) and drizzle-orm's operators
  (`eq`, `and`, `or`, `not`, `inArray`, `like`, `isNull`, `asc`, `desc`, `sql`, `count`, `sum`,
  ...) are in scope without an import.
- The code is the body of an async function: `await` works, and the last expression is the
  result (or `return` one).
- **Result** shows rows as a table (one object is one row), or the value as JSON (**Table** /
  **JSON**); **SQL** lists the statements with their parameters, row counts and times, each with
  a copy button and **Open in SQL**, which takes it to the SQL page with its values written in.
  When the code throws, the message (with the database's own words) is shown, and the
  statements that ran before it are on the SQL tab.
- A query that inserts into, updates or deletes from a table (`db.insert(post)`, ...) is
  confirmed before it runs, naming the tables. The bar under the editor lists the tables the
  code touches, with the ones it writes marked.
- **Format** (Shift + Alt + F) runs oxfmt as the schema editor does; **Copy** copies the code.
- Completion, hovers, signature help and type errors work as in the schema editor, with `db`
  typed by the schema: `db.query.` offers the tables, `post.` their columns.
- Beside the editor, the saved schema's diagram lights up the tables the code touches as you
  type — named (`post`), through `db.query.user`, or reached by a `with` through `defineRelations` —
  marks the columns it names (`post.title`), and dims the rest. Its cards are where the Schema
  page left them.
- A write refreshes the row counts in the sidebar. The code is kept in the browser.

The query runs against the **saved** schema, in the studio's process, as Drizzle's proxy driver
for the database's dialect (`drizzle-orm/sqlite-proxy`, `pg-proxy` or `mysql-proxy`) — the
drizzle-orm and TypeScript of your project are used, nothing else is installed. The schema is
loaded the way a bundler would: its `.ts` files are transpiled with your TypeScript, and imports
without an extension find their `.ts` file. Changes to the schema are picked up when it is
saved. A query is stopped waiting after 30 seconds.

### SQL

SQL against the same database, read as it is typed. The editor
([CodeMirror](https://codemirror.net/)) completes the tables and columns of the schema by the
names the database knows, and a hover over a name shows its columns or its type. About a quarter
of a second after you stop typing, each statement is analyzed against the saved schema:

- **Flow** — the statement as a data-flow picture: the tables, CTEs and subqueries it reads,
  then each clause that changes the rows (join, WHERE, GROUP BY, the SELECT list, ORDER BY,
  LIMIT), and the target of a write. Clicking a node picks out its clause in the editor.
- **Columns** — every column of the result with the expression it is, and the table columns it
  derives from (its lineage); the tables the statement touches with the columns it reads.
- **Type** — the row type as TypeScript, and the type of the parameters.
- **Result** — the rows the last statement returned, filtered and sorted in place, or the rows
  a write changed. **Ctrl/Cmd + Enter** runs the text; several statements run one by one.
- **Plan** — the plan the database chooses for the statement (`EXPLAIN QUERY PLAN`,
  `EXPLAIN (FORMAT JSON)`, `EXPLAIN FORMAT=JSON`).

Problems the analysis finds — a table or column the schema does not have, a type that does not
fit — are underlined and listed under the editor; clicking one goes there. A statement with
placeholders (`?`, `$1`) gets a field per value, typed by the column it is compared with. Beside
the editor, the schema's diagram lights up the tables the statement touches and marks the
columns it reads.

A statement opened from the Query page (**Open in SQL**) arrives with the values it was bound
with. A write refreshes the counts in the sidebar.

## Databases

| URL                                                | Driver                                                                             |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `file:./dev.db`, `sqlite:./dev.db`, `./dev.sqlite` | Node.js's built-in `node:sqlite` (Node 22.13+)                                     |
| `libsql://...` (Turso)                             | [`@libsql/client`](https://www.npmjs.com/package/@libsql/client) from your project |
| `d1://<account id>/<database id>` (Cloudflare D1)  | Cloudflare's D1 HTTP API (no package needed)                                       |
| `postgres://...`, `postgresql://...`               | [`pg`](https://www.npmjs.com/package/pg) from your project                         |
| `mysql://...`, `mariadb://...`                     | [`mysql2`](https://www.npmjs.com/package/mysql2) from your project                 |

drizzler ships no database driver of its own: Turso, PostgreSQL and MySQL use the package your
project already depends on (`npm install @libsql/client`, `npm install pg` or `npm install mysql2`
if it does not). A relative SQLite path is resolved from the directory the studio was started in.

### Hosted databases

```sh
# Turso: the token in the URL, or in TURSO_AUTH_TOKEN
TURSO_AUTH_TOKEN=... npx drizzler studio db/schema.ts --url libsql://app-ada.turso.io

# Cloudflare D1: an API token with D1 edit access, in CLOUDFLARE_D1_TOKEN (or ?token=...)
CLOUDFLARE_D1_TOKEN=... npx drizzler studio db/schema.ts --url d1://<account id>/<database id>

# Neon and PlanetScale: the connection string from their dashboard
npx drizzler studio db/schema.ts --url "postgres://user:pass@ep-cool-1.us-east-2.aws.neon.tech/app?sslmode=require"
npx drizzler studio db/schema.ts --url "mysql://user:pass@aws.connect.psdb.cloud/app"
```

- **Turso**: a local `sqld` (`turso dev`) is `libsql://127.0.0.1:8080?tls=0`.
- **Cloudflare D1**: the account id and the database id are in the dashboard, or in
  `wrangler d1 list`. Each statement is one HTTPS request, so pages answer slower than a local
  database. The database `wrangler dev` works on is a SQLite file:
  `--url file:.wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite`.
- **Neon and PlanetScale** connect over TCP with `pg` and `mysql2`. Both refuse a connection
  without TLS, so drizzler turns TLS on for their hosts (`*.neon.tech`, `*.psdb.cloud`) when the
  URL does not set `sslmode` or `ssl` itself.

The page shows the URL with its password and tokens hidden.

When the connection fails, the studio still starts: the Schema and Docs pages work, and the
sidebar shows why the database is not connected.

## Search

**Ctrl/Cmd + K** (or **Search the schema** in the sidebar) opens a palette that jumps to any
page, table, enum or column by name. The letters only have to appear in order, so `ua` finds
`userAccount` and `usemail` finds `user.email`; matches on word starts rank first. A table opens
its page, an enum its values, and a column its row in the table's Columns tab.

## Theme

The sun / moon button at the bottom of the sidebar switches between light and dark; the first
visit follows the system setting.

## Security

The API is unauthenticated, so the server listens on `127.0.0.1` only and refuses any request
whose host name is not `localhost`, `127.0.0.1` or `[::1]` — a page on another site cannot reach
it even through a DNS name that resolves to your machine. It reads and writes the schema file it
was started with and the database you pass, and runs the Drizzle code you write on the Query
page in its own process — as the SQL console runs your SQL.

## API

The page talks to a JSON API under `/api`, described in [studio-api.md](studio-api.md). Errors are
[RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem details (`application/problem+json`).

```sh
curl -s http://127.0.0.1:4983/api/db/rows/user?skip=0\&take=10
curl -s -X POST http://127.0.0.1:4983/api/db/sql -H 'content-type: application/json' \
  -d '{"sql":"SELECT count(*) AS n FROM users"}'
```

## Working on the studio

The API contract is [`main.tsp`](../main.tsp) (TypeSpec). `pnpm -F drizzler studio:api` turns it
into the `@hono/zod-openapi` routes (`src/studio/server/routes`), the typed `hc` client and the
TanStack Query hooks (`src/studio/client/api`, `hooks`) and [studio-api.md](studio-api.md), with
[hono-takibi](https://www.npmjs.com/package/hono-takibi). Handlers it has already written are kept.

| Path                         | What it is                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `src/studio/server/handlers` | One Hono handler per route: runs a use case, maps its errors to problems                                 |
| `src/studio/server/usecases` | What each route does, as [Effect](https://effect.website) programs                                       |
| `src/studio/server/services` | The schema file, the formatter, the project's TypeScript, the Drizzle query runner, the database drivers |
| `src/studio/server/domain`   | Pure functions: docs, SQL statements, parse errors, problems                                             |
| `src/studio/client`          | React + TanStack Router / Query + HeroUI + Tailwind + Monaco, built by Vite                              |

```sh
pnpm -F drizzler studio:dev   # Vite with hot reload and the API, on examples/studio/db/schema.ts
DRIZZLER_SCHEMA=path/to/schema.ts DRIZZLER_DATABASE_URL=file:./dev.db pnpm -F drizzler studio:dev
pnpm -F drizzler build        # the library (vp pack) and the client (dist/studio)
```
