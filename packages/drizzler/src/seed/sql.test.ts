import { PGlite } from "@electric-sql/pglite";
import { Faker, en } from "@faker-js/faker";
import { defineRelations } from "drizzle-orm";
import {
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { generateSeedRows } from "./generate/index.js";
import { resolveSeedConfig } from "./options.js";
import { makeSeedPlan } from "./plan.js";
import { readSchema } from "./schema.js";
import { insertStatements, makeSeedSql, renderLiteral } from "./sql.js";

const status = pgEnum("status", ["draft", "published"]);

const author = pgTable("authors", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 40 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

const book = pgTable("books", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  key: uuid("key").notNull().defaultRandom(),
  authorId: integer("author_id")
    .notNull()
    .references(() => author.id),
  title: text("title").notNull(),
  status: status("status").notNull(),
  price: numeric("price", { precision: 6, scale: 2 }).notNull(),
  inPrint: boolean("in_print").notNull(),
  published: date("published").notNull(),
  tags: text("tags").array().notNull(),
  meta: jsonb("meta"),
});

const tables = { status, author, book };

const schema = {
  ...tables,
  relations: defineRelations(tables, (r) => ({
    author: { books: r.many.book() },
    book: { author: r.one.author({ from: r.book.authorId, to: r.author.id }) },
  })),
};

const DDL = `
  CREATE TYPE status AS ENUM ('draft', 'published');
  CREATE TABLE authors (
    id SERIAL PRIMARY KEY,
    name VARCHAR(40) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT now()
  );
  CREATE TABLE books (
    id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    key UUID NOT NULL DEFAULT gen_random_uuid(),
    author_id INTEGER NOT NULL REFERENCES authors(id),
    title TEXT NOT NULL,
    status status NOT NULL,
    price NUMERIC(6, 2) NOT NULL,
    in_print BOOLEAN NOT NULL,
    published DATE NOT NULL,
    tags TEXT[] NOT NULL,
    meta JSONB
  );
`;

function entries() {
  return Effect.runSync(
    Effect.gen(function* () {
      const read = yield* readSchema(schema);
      const tables = yield* makeSeedPlan(read.tables);
      const faker = new Faker({ locale: [en] });
      faker.seed(3);
      return yield* generateSeedRows({
        tables,
        config: resolveSeedConfig({
          schema,
          models: { author: { count: 3 }, book: { count: 10 } },
        }),
        faker,
      });
    }),
  );
}

describe("makeSeedSql", () => {
  it("writes a PostgreSQL script that runs, and moves the sequences past the rows", async () => {
    const sql = makeSeedSql({
      dialect: "postgresql",
      entries: entries(),
      reset: true,
      seed: 3,
      locale: [],
    });
    expect(sql).toContain('INSERT INTO "books" ("id", "key", "author_id"');
    expect(sql).toContain("OVERRIDING SYSTEM VALUE VALUES");
    expect(sql).toContain(`SELECT setval(pg_get_serial_sequence('"authors"', 'id')`);
    const db = new PGlite();
    await db.exec(DDL);
    await db.exec(sql);
    const counts = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM books");
    expect(counts.rows[0]?.n).toBe(10);
    // The application's next author takes the number after the seeded ones.
    const next = await db.query<{ id: number }>(
      "INSERT INTO authors (name) VALUES ('x') RETURNING id",
    );
    expect(next.rows[0]?.id).toBe(4);
    const book = await db.query<{ tags: string[]; status: string }>(
      "SELECT tags, status FROM books WHERE id = 1",
    );
    expect(Array.isArray(book.rows[0]?.tags)).toBe(true);
    expect(["draft", "published"]).toContain(book.rows[0]?.status);
    await db.close();
  });

  it("binds the same rows as parameters", async () => {
    const db = new PGlite();
    await db.exec(DDL);
    for (const entry of entries()) {
      for (const statement of insertStatements("postgresql", entry, false)) {
        await db.query(statement.sql, [...statement.params]);
      }
    }
    const counts = await db.query<{ n: number }>("SELECT COUNT(*)::int AS n FROM authors");
    expect(counts.rows[0]?.n).toBe(3);
    await db.close();
  });
});

describe("renderLiteral", () => {
  it("quotes text, bytes and booleans as each dialect reads them", () => {
    expect(renderLiteral("postgresql", "it's")).toBe("'it''s'");
    expect(renderLiteral("mysql", "a\\b'c")).toBe("'a\\\\b''c'");
    expect(renderLiteral("sqlite", Uint8Array.from([1, 255]))).toBe("X'01ff'");
    expect(renderLiteral("postgresql", Uint8Array.from([1, 255]))).toBe("'\\x01ff'");
    expect(renderLiteral("mysql", true)).toBe("TRUE");
    expect(renderLiteral("sqlite", null)).toBe("NULL");
    expect(renderLiteral("postgresql", 10n)).toBe("10");
  });
});
