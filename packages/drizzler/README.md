# Drizzler

**[Drizzler](https://www.npmjs.com/package/drizzler)** reads a [Drizzle](https://orm.drizzle.team/) schema — with the comments you already write as its descriptions — into ER diagrams and DBML, and opens it in a local studio.

## Features

- 📊 Creates [Mermaid](https://mermaid.js.org/) ER diagrams
- 📝 Generates [DBML](https://dbml.dbdiagram.io/) (Database Markup Language) files
- 🖼️ Draws ER diagrams as **SVG** / **PNG** images (light and dark)
- 🗂️ Reads a schema split over many files (a directory, a glob, or `drizzle.config.ts`'s `schema`), following the helpers and relations it imports
- 🔗 Draws [relations v2](https://orm.drizzle.team/docs/relations) (`defineRelations`) even where no foreign key exists, dashed so they are told apart from real constraints
- 💬 Describes tables and columns from plain TypeScript comments (`/** … */` or `//`), nothing drizzler-specific
- ✏️ `drizzler studio`: edit the schema in Monaco beside its live ER diagram, read its generated docs, run Drizzle queries and SQL, and browse and edit the database's rows
- 🌱 `drizzler seed`: fill the database with rows from [faker](https://fakerjs.dev/) or your own, typed against the schema and keeping every foreign key and unique key

## Installation

```bash
npm install -D drizzler
```

## Usage

```
drizzler [input...] -o <output> [options]
drizzler studio <input> [--port <port>] [--url <database-url>]
drizzler seed [--config <path>] [--url <database-url>] [--sql <file>] [--seed <n>] [--count <n>] [--locale <locale>] [--reset]
```

`input` is one or more files, directories or globs. Left out, drizzler reads the `schema` of
`drizzle.config.ts` (or `.mts`, `.js`, ...) in the current directory. The flags can come before or
after the input. A command line that cannot run (a missing `-o`,
an unknown format, a file that is not there) prints why and exits with code 1.

### Options

```
-o, --output <path>               Output file path (.md, .dbml, .svg, .png)
--theme <light|dark>              Colour scheme of the .svg / .png ER diagram
-p, --port <port>                 Port for drizzler studio (default: 4983)
-u, --url <database-url>          Database for drizzler studio (default: $DATABASE_URL)
-h, --help                        Display help message (drizzler studio --help, drizzler seed --help)
-v, --version                     Print the version
```

### Quick Start

```sh
# Generate DBML
npx drizzler db/schema.ts -o docs/schema.dbml

# Generate ER diagram (SVG or PNG)
npx drizzler db/schema.ts -o docs/er.svg
npx drizzler db/schema.ts -o docs/er.png --theme dark

# Generate Mermaid ER diagram
npx drizzler db/schema.ts -o docs/ER.md

# Edit the schema, its ER diagram, docs and data in the browser
npx drizzler studio db/schema.ts --url file:./dev.db

# Fill the database with the rows drizzler.config.ts describes
npx drizzler seed
```

## Schemas Split Over Files

Layered projects often keep one table per file, export the tables in a list, build them with a
casing helper, and share columns through a helper module:

```
src/adapter/secondary/persistence/rdb/schema/
├── columns.helpers.ts   # const timestamps = { createdAt, updatedAt }
├── cart.sql.ts          # const cartTable = snakeCase.table("cart", { ..., ...timestamps })
├── cartItem.sql.ts      # .references(() => cartTable.customerId)
├── product.sql.ts
└── relations.sql.ts     # defineRelations({ ... }, (r) => ({ ... }))
```

```sh
# The schema drizzle-kit is configured with (schema: "./src/.../schema/*.sql.ts")
npx drizzler -o docs/er.svg

# Or name it: a directory, a glob, or several files
npx drizzler src/adapter/secondary/persistence/rdb/schema -o docs/er.svg
npx drizzler "src/**/schema/*.sql.ts" -o docs/ER.md
```

What drizzler reads across the files:

- every file given, and each project module they import or re-export, through relative paths and
  the tsconfig's `paths` (`#/*`, `@/*`); packages and `import type` are not followed, nor are test
  and declaration files in a directory
- tables declared plainly and exported in a list (`const user = pgTable(...); export { user };`)
  as well as `export const`
- `pgTable`, `sqliteTable`, `mysqlTable`, ..., `pgTable.withRLS`, and the `.table` of a casing or
  schema (`snakeCase.table`, `camelCase.table`, `pgSchema("auth").table`)
- columns spread from another object (`...timestamps`), with their comments, and the callback form
  `pgTable("user", (t) => ({ id: t.integer() }))`
- column builders without a name (`varchar({ length: 26 })`), named by their key

[examples/layered](https://github.com/nakita628/drizzler/tree/main/examples/layered) is such a
project, with its [ER diagram](https://github.com/nakita628/drizzler/blob/main/examples/layered/docs/er.png).

## Comments

A comment written directly above a table, a column or an enum is its description — in the DBML
notes, the Mermaid diagram, the ER diagram's cards and the studio's docs. Any TypeScript comment
will do: a JSDoc block, a block comment, or `//` lines.

```ts
/** Everyone who can sign in */
export const user = mysqlTable("user", {
  /** Primary key */
  id: varchar("id", { length: 36 }).primaryKey(),
  // Display name
  name: varchar("name", { length: 50 }).notNull(),
});
```

- The lines of a comment, or of a run of `//` lines, are joined into one description.
- A comment that ends a line of code (`id: int(), // ...`) belongs to that line, and one
  separated by a blank line (a file header) describes nothing.
- Lines starting with `@` are tags (`@deprecated`, ...), not description.

## Output Examples

### DBML

```sh
npx drizzler db/schema.ts -o docs/schema.dbml
```

```dbml
Table user {
  id varchar [pk, note: 'Primary key']
  name varchar [note: 'Display name']
  Note: 'Everyone who can sign in'
}

Table post {
  id varchar [pk]
  title varchar
  userId varchar
}

Ref post_userId_user_id_fk: post.userId > user.id
```

### Mermaid ER

```sh
npx drizzler db/schema.ts -o docs/ER.md
```

```mermaid
erDiagram
    user ||--|{ post : "(id) - (userId)"
    user {
        varchar id PK "Primary key"
        varchar name "Display name"
    }
    post {
        varchar id PK
        varchar title
        varchar userId FK
    }
```

### ER Diagram (SVG / PNG)

```sh
npx drizzler db/schema.ts -o docs/er.svg
npx drizzler db/schema.ts -o docs/er.png --theme dark
```

![ER diagram](https://github.com/nakita628/drizzler/blob/main/fixtures/example/docs/er-diagram.png)

Tables are laid out left to right along their relations. Each card shows its columns with
the primary key, foreign keys, `UK` for unique columns, `?` for nullable ones, defaults
(`.default()`, `.defaultNow()`, `$defaultFn()`, `$onUpdate()`), the comments' descriptions and the
indexes, unique and composite key constraints of the table. `pgEnum`s get a card of their own.
Edges use crow's-foot notation and name the relation and its `onDelete` / `onUpdate` action;
an edge declared only by `defineRelations` is dashed, since nothing in the database backs it.

## Studio

```sh
npx drizzler studio db/schema.ts
npx drizzler studio db/schema.ts --url file:./dev.db          # SQLite (node:sqlite)
npx drizzler studio db/schema.ts --url postgres://localhost/app # pg from your project
```

Opens `http://127.0.0.1:4983` with these pages:

- **Schema**: the saved schema's ER diagram across the page, as draggable cards.
- **Drizzle schema**: the file in Monaco with the diagram beside it, redrawn as you
  type; the table under the cursor is selected. Completion, hovers, signature help and type errors
  come from the project's TypeScript and drizzle-orm's types; syntax errors are underlined with
  their line while the last good drawing stays. Ctrl/Cmd + S saves, **Format** runs oxfmt, and
  the diagram downloads as SVG or PNG, laid out as on the canvas.
- **Docs**: every table, column, key, default, index, relation (both ways) and enum, with the
  comments' descriptions, and Drizzle queries for each table to open in the Query page.
- **Query**: Drizzle against the database (`db.select().from(post)`,
  `db.query.post.findMany({ with: { author: true } })`), with completion, the result as a table
  or JSON, the SQL it sent, and a diagram that lights up the tables the code touches.
- **Tables and enums**: a page per table with its rows — searched, edited in place, copied,
  exported, added and deleted (composite keys included) — and its columns, relations and
  indexes; a page per enum with its values and the columns that hold it.
- **SQL**: SQL read as it is typed — its data flow, the lineage and types of its columns, its
  parameters, the problems in it and its plan — and run on the same database.

**Format** follows the project's `.oxfmtrc.json` when it has one. The server listens on
`127.0.0.1` only.

See [docs/studio.md](https://github.com/nakita628/drizzler/blob/main/packages/drizzler/docs/studio.md) for the full guide and
[docs/studio-api.md](https://github.com/nakita628/drizzler/blob/main/packages/drizzler/docs/studio-api.md) for its API.

## Seed

```sh
npx drizzler seed                 # insert into the database of the config's url, or DATABASE_URL
npx drizzler seed --sql seed.sql  # or write the rows as a SQL script
```

`drizzler.config.ts` imports the Drizzle schema module and says what to insert. `defineConfig` types
it against the schema: every table (by its export name), column, relation and bound is checked,
and a rule function knows the row it sees.

```ts
// drizzler.config.ts
import { defineConfig } from "drizzler";

import * as schema from "./db/schema";

export default defineConfig(schema, {
  url: "file:./dev.db",
  seed: 42,
  models: {
    // Rows from faker, shaped by rules
    user: {
      count: 20,
      fields: { age: { min: 18, max: 65 }, nickname: { nullRate: 0.3 } },
      relations: { posts: { min: 1, max: 3 } },
    },
    post: { count: 40 },
    // Or real rows, as they are
    tag: { data: [{ label: "drizzle" }, { label: "effect" }] },
  },
});
```

A model is seeded from faker (`count`, `fields`) or from real rows (`data`), not both. In a real
row no id is written by hand:

- a column left out takes its default (`.default()`, `$defaultFn()`, the next number of a serial or
  autoincrement), and one with a SQL default (`` sql`CURRENT_TIMESTAMP` ``) is left to the database;
- an `r.many` relation nests the child rows, whose key to the parent is filled in
  (`posts: [{ title: "Hello" }]`);
- an `r.one` relation names the parent by a unique key (`author: { email: "ann@example.com" }`);
  left out, a required one is linked to a row that exists.

`defineData(schema, "user", [...])` types rows kept in their own file.

The tables are filled parents first, and every foreign key, unique key, enum, length and
nullability is respected; a relation that only `defineRelations` declares is filled like a
foreign key. Every row is checked against its columns before anything is written, and the rows
go in one transaction (on PostgreSQL, the sequences are moved past them). The seeder fills tables
that exist; create them first, with drizzle-kit or your migrations.

| Option                     | What it does                                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `seed`                     | The faker seed: the same seed gives the same rows                                                                                   |
| `locale`                   | The faker locale, or several tried in order (`["ja", "en"]`)                                                                        |
| `count`                    | Rows for every table without a rule of its own                                                                                      |
| `nullRate`                 | How often a nullable column is null, from 0 to 1                                                                                    |
| `dates`                    | The window every date falls in (`{ from, to }`)                                                                                     |
| `url`                      | The database (`file:./dev.db`, `postgres://...`, `mysql://...`)                                                                     |
| `output`                   | Write SQL to this file instead of inserting                                                                                         |
| `reset`                    | Delete every row of the seeded tables first                                                                                         |
| `models.<table>.fields`    | Per column: a function `(faker, { index, row }) => value`, or `value`, `values`, `min` / `max`, `from` / `to`, `length`, `nullRate` |
| `models.<table>.relations` | Per `r.many` relation: how many children each row has (`min` / `max`)                                                               |

The command line overrides the config: `--url`, `--sql <file>`, `--seed <n>`, `--count <n>`,
`--locale ja,en`, `--reset` and `--config <path>`. SQLite is written through `node:sqlite`,
PostgreSQL through `pg` and MySQL through `mysql2`, as installed in your project.

## Relation Detection

Drizzler detects relations from three sources. They are reflected consistently
across every ER output format (Mermaid, DBML, SVG and PNG).

### 1. `.references()` chain

```ts
userId: varchar("user_id").references(() => user.id);
```

### 2. `foreignKey()` constraint

```ts
export const post = pgTable('post', { ... }, (t) => [
  foreignKey({ columns: [t.userId], foreignColumns: [user.id] }),
])
```

The older object form, `(t) => ({ fk: foreignKey(...) })`, is read as well.

### 3. `defineRelations` (no foreign key required)

Relations are read as Drizzle's [relations v2](https://orm.drizzle.team/docs/relations) declare
them: every `defineRelations` and `defineRelationsPart` export, whatever it is named.

```ts
import { defineRelations } from "drizzle-orm";

export const post = pgTable("post", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(), // no .references()
});

export const relations = defineRelations({ user, post }, (r) => ({
  post: { author: r.one.user({ from: r.post.userId, to: r.user.id }) },
  user: { posts: r.many.post() },
}));
```

Relations are not database constraints, so a relation with `from` and `to` is drawn even when no
foreign key backs it. Such an edge is dashed; when a `.references()` or `foreignKey()` backs the
same pair, it is drawn solid as that foreign key. The child side is "one or more" when its column
is `.notNull()` (or the `r.one` is `optional: false`), else "zero or more"; when that column is
a key of its own (`.primaryKey()`, `.unique()`, a one-column unique constraint) it is "one" or
"zero or one", a one-to-one. The same holds for a foreign key.

`from` is not always the side that holds the key (`r.one.profile({ from: r.user.id, to:
r.profile.userId })`), so the child is the side whose column is a foreign key to the other; else
the side that is not a primary or unique key; else the one with an `...Id` name; else `from`.
A many-to-many through a junction table (`r.user.id.through(r.member.userId)`) is drawn as a key
from the junction to each end. A relation with no `from` / `to` adds nothing on its own: it is the
reverse side of a pair the other table declares.

## License

Distributed under the MIT License. See [LICENSE](https://github.com/nakita628/drizzler?tab=MIT-1-ov-file) for more information.
