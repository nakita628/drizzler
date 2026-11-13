import { Faker, en } from "@faker-js/faker";
import { defineRelations } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import type { SeedConfig } from "../config.js";
import { resolveSeedConfig } from "../options.js";
import { makeSeedPlan } from "../plan.js";
import { readSchema } from "../schema.js";
import { generateSeedRows } from "./index.js";

const user = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
  age: integer("age"),
});

const post = sqliteTable("posts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  authorId: integer("author_id")
    .notNull()
    .references(() => user.id),
  title: text("title").notNull(),
  status: text("status", { enum: ["draft", "published"] }).notNull(),
});

/** A profile per user, joined by a unique key. */
const profile = sqliteTable(
  "profiles",
  {
    id: integer("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => user.id),
    bio: text("bio"),
  },
  (t) => [uniqueIndex("profiles_user").on(t.userId)],
);

/** No foreign key: only the relation says who acted. */
const auditLog = sqliteTable("audit_logs", {
  id: integer("id").primaryKey(),
  actorId: integer("actor_id").notNull(),
  action: text("action").notNull(),
});

const tables = { user, post, profile, auditLog };

const schema = {
  ...tables,
  relations: defineRelations(tables, (r) => ({
    user: { posts: r.many.post(), logs: r.many.auditLog() },
    post: { author: r.one.user({ from: r.post.authorId, to: r.user.id }) },
    auditLog: { actor: r.one.user({ from: r.auditLog.actorId, to: r.user.id }) },
  })),
};

function generate(config: Omit<SeedConfig, "schema">) {
  return Effect.gen(function* () {
    const read = yield* readSchema(schema);
    const tables = yield* makeSeedPlan(read.tables);
    const faker = new Faker({ locale: [en] });
    faker.seed(7);
    const entries = yield* generateSeedRows({
      tables,
      config: resolveSeedConfig({ ...config, schema }),
      faker,
    });
    return Object.fromEntries(entries.map((entry) => [entry.table.name, entry.rows]));
  });
}

describe("generateSeedRows", () => {
  it("makes faker rows that point at rows that exist and keep their unique keys", () => {
    const rows = Effect.runSync(
      generate({
        models: {
          user: { count: 5, fields: { age: { min: 20, max: 30 } } },
          post: { count: 12 },
          profile: { count: 5 },
          auditLog: { count: 4 },
        },
      }),
    );
    const users = rows.user ?? [];
    expect(users.map((u) => u.id)).toStrictEqual([1, 2, 3, 4, 5]);
    expect(new Set(users.map((u) => u.email)).size).toBe(5);
    expect(users.every((u) => typeof u.age === "number" && u.age >= 20 && u.age <= 30)).toBe(true);
    const ids = new Set(users.map((u) => u.id));
    expect((rows.post ?? []).every((p) => ids.has(p.authorId as number))).toBe(true);
    expect(
      (rows.post ?? []).every((p) => ["draft", "published"].includes(p.status as string)),
    ).toBe(true);
    // One profile per user: the unique key deals the parents out once each.
    expect(new Set((rows.profile ?? []).map((p) => p.userId)).size).toBe(5);
    // The relation without a foreign key is filled all the same.
    expect((rows.auditLog ?? []).every((l) => ids.has(l.actorId as number))).toBe(true);
  });

  it("gives the same rows for the same seed", () => {
    const config = { models: { user: { count: 3 }, post: { count: 3 } } };
    const first = Effect.runSync(generate(config));
    const second = Effect.runSync(generate(config));
    expect(second).toStrictEqual(first);
  });

  it("inserts real rows as written, nests children and names parents by a unique key", () => {
    const rows = Effect.runSync(
      generate({
        models: {
          user: {
            data: [
              {
                email: "ann@example.com",
                name: "Ann",
                posts: [{ title: "Hello", status: "published" }],
              },
              { email: "bob@example.com", name: "Bob", isAdmin: true },
            ],
          },
          post: {
            data: [{ title: "By Bob", status: "draft", author: { email: "bob@example.com" } }],
          },
        },
      }),
    );
    expect(rows.user).toStrictEqual([
      { id: 1, email: "ann@example.com", name: "Ann", isAdmin: false, age: null },
      { id: 2, email: "bob@example.com", name: "Bob", isAdmin: true, age: null },
    ]);
    expect(rows.post).toStrictEqual([
      { id: 1, title: "By Bob", status: "draft", authorId: 2 },
      { id: 2, title: "Hello", status: "published", authorId: 1 },
    ]);
  });

  it("deals children out to meet a parent's relation rule", () => {
    const rows = Effect.runSync(
      generate({
        models: {
          user: { count: 4, relations: { posts: { min: 2, max: 2 } } },
          post: { count: 8 },
        },
      }),
    );
    const counts = Map.groupBy(rows.post ?? [], (p) => p.authorId);
    expect([...counts.values()].map((list) => list.length)).toStrictEqual([2, 2, 2, 2]);
  });

  it("reports what is wrong with the config before anything is made", () => {
    const error = Effect.runSync(
      Effect.flip(
        generate({
          models: {
            nobody: { count: 1 },
            user: { data: [{ email: "x@example.com", nickname: "x" }] },
            post: {
              count: 1,
              fields: { missing: { value: 1 } },
              relations: { author: { min: 1 } },
            },
          },
        }),
      ),
    );
    expect(error.message).toContain("models.nobody: the schema exports no table named nobody.");
    expect(error.message).toContain(
      "models.user.data[0].nickname: user has no column or relation named nickname the seeder can write.",
    );
    expect(error.message).toContain("models.post.fields.missing: post has no column named missing");
    expect(error.message).toContain(
      "models.post.relations.author: post has no relation named author",
    );
  });

  it("fails validation on a value the column cannot hold, and on a required column left out", () => {
    const invalid = Effect.runSync(
      Effect.flip(
        generate({ models: { user: { count: 1, fields: { email: { value: "nope" } } } } }),
      ),
    );
    expect(invalid.message).toContain("user[0].email: Invalid email address");
    const missing = Effect.runSync(
      Effect.flip(generate({ models: { user: { data: [{ email: "a@example.com" }] } } })),
    );
    expect(missing.message).toContain(
      "user data[0].name: the column is required and has no default, so the row must give it.",
    );
  });
});
