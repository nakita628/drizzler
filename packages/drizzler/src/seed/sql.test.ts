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
import { describe, expect, it } from "vite-plus/test";
import { generateSeedRows } from "./generate/index.js";
import { resolveSeedConfig } from "./options.js";
import { makeSeedPlan } from "./plan.js";
import { readSchema } from "./schema.js";
import { insertStatements, makeSeedSql, makeSeedStatements, renderLiteral } from "./sql.js";
import { makeSeedReport } from "./report.js";
import type { Result } from "./result.js";

/** A step's value; a failure fails the test with it. */
function value<A, E>(result: Result<A, E>): A {
  if (!result.ok) throw result.error;
  return result.value;
}

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
  const faker = new Faker({ locale: [en] });
  faker.seed(3);
  const generated = generateSeedRows({
    tables: value(makeSeedPlan(value(readSchema(schema)).tables)),
    config: resolveSeedConfig(
      {
        schema,
        models: { author: { count: 3 }, book: { count: 10 } },
      },
      new Date(),
    ),
    faker,
  });
  return value(generated);
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

describe("makeSeedStatements", () => {
  it("resets, inserts every row, then moves PostgreSQL's sequences, in that order", () => {
    const made = entries();
    const statements = makeSeedStatements({ dialect: "postgresql", entries: made, reset: true });
    const inserts = made.flatMap((entry) => insertStatements("postgresql", entry, false));
    const sqls = statements.map((statement) => statement.sql);
    const firstInsert = sqls.findIndex((sql) => sql.startsWith("INSERT"));
    const lastInsert = sqls.findLastIndex((sql) => sql.startsWith("INSERT"));
    expect(sqls.slice(0, firstInsert).every((sql) => !sql.startsWith("INSERT"))).toBe(true);
    expect(firstInsert).toBeGreaterThan(0);
    expect(sqls.slice(firstInsert, lastInsert + 1)).toStrictEqual(inserts.map((i) => i.sql));
    expect(sqls.slice(lastInsert + 1).length).toBeGreaterThan(0);
  });

  it("sends only the inserts without a reset, and no sequence fix-up on SQLite", () => {
    const made = entries();
    expect(makeSeedStatements({ dialect: "sqlite", entries: made, reset: false })).toStrictEqual(
      made.flatMap((entry) => insertStatements("sqlite", entry, false)),
    );
  });
});

describe("makeSeedReport", () => {
  it("counts the rows made for each table", () => {
    const made = entries();
    const report = makeSeedReport({
      seed: 3,
      locale: null,
      configPath: "a.ts",
      dialect: "postgresql",
      entries: made,
    });
    expect(report.locale).toStrictEqual([]);
    expect(report.tables.map((t) => t.rows)).toStrictEqual(made.map((entry) => entry.rows.length));
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
