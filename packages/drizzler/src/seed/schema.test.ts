import { defineRelations, defineRelationsPart, sql } from "drizzle-orm";
import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { integer as sqliteInteger, sqliteTable, text as sqliteText } from "drizzle-orm/sqlite-core";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";
import { makeSeedPlan } from "./plan.js";
import { readSchema } from "./schema.js";

const role = pgEnum("role", ["owner", "member"]);

const user = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  role: role("role").notNull().default("member"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  note: text("note").default(sql`'none'`),
});

const post = pgTable(
  "posts",
  {
    id: serial("id").primaryKey(),
    authorId: uuid("author_id")
      .notNull()
      .references(() => user.id),
    slug: varchar("slug", { length: 64 }).notNull(),
    published: boolean("published").notNull().default(false),
  },
  (t) => [uniqueIndex("posts_slug").on(t.slug)],
);

/** No foreign key: only the relation below says where `actorId` points. */
const auditLog = pgTable("audit_logs", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  actorId: uuid("actor_id").notNull(),
});

const member = pgTable(
  "members",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id),
    postId: integer("post_id")
      .notNull()
      .references(() => post.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.postId] })],
);

const tables = { role, user, post, auditLog, member };

const schema = {
  ...tables,
  relations: defineRelations(tables, (r) => ({
    user: { posts: r.many.post(), logs: r.many.auditLog() },
    post: { author: r.one.user({ from: r.post.authorId, to: r.user.id }) },
    auditLog: { actor: r.one.user({ from: r.auditLog.actorId, to: r.user.id }) },
  })),
};

describe("readSchema", () => {
  it("reads the tables, keys and relations of a Drizzle schema", () => {
    const read = Effect.runSync(readSchema(schema));
    expect(read.dialect).toBe("postgresql");
    const [u, p, a, m] = read.tables;

    expect(u?.columns.map((c) => [c.field, c.kind, c.isRequired, c.databaseFills])).toStrictEqual([
      ["id", "uuid", true, false],
      ["email", "string", true, false],
      ["role", "enum", true, false],
      ["createdAt", "date", true, false],
      ["note", "string", false, true],
    ]);
    expect(u?.uniques).toStrictEqual([["id"], ["email"]]);
    expect(u?.parents).toStrictEqual([
      { name: "posts", child: "post", key: "author", isList: true },
      { name: "logs", child: "auditLog", key: "actor", isList: true },
    ]);

    expect(p?.columns.find((c) => c.field === "id")?.autoincrement).toBe(true);
    expect(p?.uniques).toStrictEqual([["id"], ["slug"]]);
    expect(p?.foreignKeys).toStrictEqual([
      {
        field: "author",
        fromFields: ["authorId"],
        toModel: "user",
        toFields: ["id"],
        required: true,
        oneToOne: false,
        self: false,
        enforced: true,
      },
    ]);

    expect(a?.columns.find((c) => c.field === "id")?.identityAlways).toBe(true);
    expect(a?.foreignKeys.map((fk) => [fk.field, fk.enforced])).toStrictEqual([["actor", false]]);

    expect(m?.uniques).toStrictEqual([["userId", "postId"]]);
    expect(m?.foreignKeys.map((fk) => [fk.field, fk.toModel])).toStrictEqual([
      ["userId", "user"],
      ["postId", "post"],
    ]);
  });

  it("reads keys only relations declare: a one-to-one from the parent, a junction, a part", () => {
    const account = sqliteTable("accounts", { id: sqliteInteger("id").primaryKey() });
    /** No foreign keys: the relations say every key. */
    const profile = sqliteTable("profiles", {
      id: sqliteInteger("id").primaryKey(),
      accountId: sqliteInteger("account_id").notNull().unique(),
    });
    const group = sqliteTable("groups", { id: sqliteInteger("id").primaryKey() });
    const membership = sqliteTable("memberships", {
      accountId: sqliteInteger("account_id").notNull(),
      groupId: sqliteInteger("group_id").notNull(),
    });
    const tables = { account, profile, group, membership };
    const read = Effect.runSync(
      readSchema({
        ...tables,
        // `from` is the parent here: the key is on the target.
        relations: defineRelations(tables, (r) => ({
          account: {
            profile: r.one.profile({ from: r.account.id, to: r.profile.accountId }),
            groups: r.many.group({
              from: r.account.id.through(r.membership.accountId),
              to: r.group.id.through(r.membership.groupId),
            }),
          },
        })),
        part: defineRelationsPart(tables, (r) => ({
          profile: { owner: r.one.account({ from: r.profile.accountId, to: r.account.id }) },
        })),
      }),
    );
    const [a, p, , m] = read.tables;
    expect(p?.foreignKeys).toStrictEqual([
      {
        field: "owner",
        fromFields: ["accountId"],
        toModel: "account",
        toFields: ["id"],
        required: true,
        oneToOne: true,
        self: false,
        enforced: false,
      },
    ]);
    expect(a?.parents).toStrictEqual([
      { name: "profile", child: "profile", key: "owner", isList: false },
    ]);
    expect(m?.foreignKeys.map((fk) => [fk.fromFields, fk.toModel])).toStrictEqual([
      [["accountId"], "account"],
      [["groupId"], "group"],
    ]);
  });

  it("orders the models parents first", () => {
    const read = Effect.runSync(readSchema(schema));
    const plan = Effect.runSync(makeSeedPlan(read.tables.toReversed()));
    expect(plan.map((t) => t.name)).toStrictEqual(["user", "post", "member", "auditLog"]);
  });

  it("reports a cycle of required keys", () => {
    const a = sqliteTable("a", {
      id: sqliteInteger("id").primaryKey(),
      bId: sqliteInteger("b_id")
        .notNull()
        .references((): AnySQLiteColumn => b.id),
    });
    const b = sqliteTable("b", {
      id: sqliteInteger("id").primaryKey(),
      aId: sqliteInteger("a_id")
        .notNull()
        .references(() => a.id),
    });
    const read = Effect.runSync(readSchema({ a, b }));
    const error = Effect.runSync(Effect.flip(makeSeedPlan(read.tables)));
    expect(error.message).toContain("Required relations form a cycle: a -> b -> a");
  });

  it("numbers a SQLite integer primary key and refuses a schema without tables", () => {
    const tag = sqliteTable("tags", {
      id: sqliteInteger("id").primaryKey(),
      name: sqliteText("name").notNull(),
    });
    const read = Effect.runSync(readSchema({ tag }));
    expect(read.dialect).toBe("sqlite");
    expect(read.tables[0]?.columns[0]?.autoincrement).toBe(true);
    const error = Effect.runSync(Effect.flip(readSchema({ relations: defineRelations({}) })));
    expect(error.message).toContain("The schema exports no tables");
  });
});
