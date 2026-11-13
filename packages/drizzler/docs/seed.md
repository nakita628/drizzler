# drizzler seed

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
foreign key. On a foreign-key column, a field rule that only sets `nullRate` keeps the column
linked to a parent row; any other rule fills the column as it says. Every row is checked against
its columns before anything is written, and the rows go in one transaction (on PostgreSQL, the
sequences are moved past them). The seeder fills tables that exist; create them first, with
drizzle-kit or your migrations.

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
