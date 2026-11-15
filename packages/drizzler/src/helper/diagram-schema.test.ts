import { describe, expect, it } from "vite-plus/test";
import { diagramSchema } from "./diagram-schema.js";

describe("diagramSchema", () => {
  it("reads columns, enums, constraints and referential actions", () => {
    const code = [
      "export const role = pgEnum('user_role', ['admin', 'member'])",
      "",
      "/// People who sign in",
      "export const user = pgTable('users', {",
      "  /// Primary key",
      "  /// @z.uuid()",
      "  id: uuid('id').primaryKey().defaultRandom(),",
      "  email: text('email').notNull().unique(),",
      "  role: role('role').notNull().default('member'),",
      "  tags: text('tags').array(),",
      "})",
      "",
      "export const membership = pgTable('membership', {",
      "  userId: uuid('user_id').notNull(),",
      "  groupId: uuid('group_id').notNull(),",
      "}, (t) => [",
      "  primaryKey({ columns: [t.userId, t.groupId] }),",
      "  index('membership_group_idx').on(t.groupId),",
      "  foreignKey({ columns: [t.userId], foreignColumns: [user.id] }).onDelete('cascade'),",
      "])",
    ];

    const schema = diagramSchema(code);

    expect(schema.enums).toStrictEqual([
      {
        name: "role",
        dbName: "user_role",
        documentation: null,
        values: [
          { name: "admin", dbName: null },
          { name: "member", dbName: null },
        ],
      },
    ]);

    const [user, membership] = schema.models;
    expect(user?.name).toBe("user");
    expect(user?.dbName).toBe("users");
    expect(user?.documentation).toBe("People who sign in");
    expect(user?.fields).toStrictEqual([
      {
        name: "id",
        dbName: null,
        kind: "scalar",
        type: "uuid",
        isList: false,
        isRequired: true,
        isId: true,
        isUnique: false,
        isForeignKey: false,
        documentation: "Primary key",
        attributes: [".defaultRandom()"],
      },
      {
        name: "email",
        dbName: null,
        kind: "scalar",
        type: "text",
        isList: false,
        isRequired: true,
        isId: false,
        isUnique: true,
        isForeignKey: false,
        documentation: null,
        attributes: [],
      },
      {
        name: "role",
        dbName: null,
        kind: "enum",
        type: "role",
        isList: false,
        isRequired: true,
        isId: false,
        isUnique: false,
        isForeignKey: false,
        documentation: null,
        attributes: [".default('member')"],
      },
      {
        name: "tags",
        dbName: null,
        kind: "scalar",
        type: "text",
        isList: true,
        isRequired: false,
        isId: false,
        isUnique: false,
        isForeignKey: false,
        documentation: null,
        attributes: [],
      },
    ]);

    expect(membership?.primaryKey).toStrictEqual(["userId", "groupId"]);
    expect(membership?.indexes).toStrictEqual([
      { type: "id", fields: ["userId", "groupId"] },
      { type: "normal", fields: ["groupId"], name: "membership_group_idx" },
    ]);
    expect(membership?.fields.map((f) => [f.name, f.dbName, f.isForeignKey])).toStrictEqual([
      ["userId", "user_id", true],
      ["groupId", "group_id", false],
    ]);

    expect(schema.relations).toStrictEqual([
      {
        origin: "inferred",
        name: null,
        onDelete: "cascade",
        onUpdate: null,
        from: { model: "user", field: "id", cardinality: "one" },
        to: { model: "membership", field: "userId", cardinality: "many" },
      },
    ]);
  });

  it("reads the actions of .references() and the object form of constraints", () => {
    const code = [
      "export const user = sqliteTable('user', { id: text('id').primaryKey() })",
      "export const post = sqliteTable('post', {",
      "  authorId: text('author_id').references(() => user.id, { onDelete: 'set null', onUpdate: 'cascade' }),",
      "}, (table) => ({",
      "  authorIdx: uniqueIndex('post_author').on(table.authorId),",
      "}))",
    ];

    const schema = diagramSchema(code);

    expect(schema.models[1]?.indexes).toStrictEqual([
      { type: "unique", fields: ["authorId"], name: "post_author" },
    ]);
    expect(schema.relations.map((r) => [r.onDelete, r.onUpdate, r.to.cardinality])).toStrictEqual([
      ["set null", "cascade", "zero-one"],
    ]);
  });

  it("draws a defineRelations-only relation dashed by keeping its origin", () => {
    const code = [
      "export const user = sqliteTable('user', { id: text('id').primaryKey() })",
      "export const post = sqliteTable('post', { authorId: text('author_id') })",
      "export const postRelations = defineRelations({ post, user }, (r) => ({",
      "  post: {",
      "    author: r.one.user({ from: r.post.authorId, to: r.user.id }),",
      "  },",
      "}))",
    ];

    const [relation] = diagramSchema(code).relations;

    expect(relation?.origin).toBe("relations");
    expect(diagramSchema(code).models[1]?.fields[0]?.isForeignKey).toBe(true);
  });
});

describe("diagramSchema of tables built in a function", () => {
  it("draws the tables, their keys and the foreign keys between them", () => {
    const schema = diagramSchema([
      "export function defineTables(schema = {}) {",
      "  const users = schema.users ?? sqliteTable('user', {",
      "    id: text('id').primaryKey(),",
      "    email: text('email').unique(),",
      "  })",
      "  const accounts = schema.accounts ?? sqliteTable('account', {",
      "    userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),",
      "    provider: text('provider').notNull(),",
      "    providerAccountId: text('providerAccountId').notNull(),",
      "  }, (account) => ({",
      "    compositePk: primaryKey({ columns: [account.provider, account.providerAccountId] }),",
      "  }))",
      "  return { users, accounts }",
      "}",
      "",
      "export const { users, accounts } = defineTables()",
    ]);

    expect(
      schema.models.map((m) => ({
        name: m.name,
        dbName: m.dbName,
        primaryKey: m.primaryKey,
        ids: m.fields.filter((f) => f.isId).map((f) => f.name),
        unique: m.fields.filter((f) => f.isUnique).map((f) => f.name),
      })),
    ).toStrictEqual([
      { name: "users", dbName: "user", primaryKey: null, ids: ["id"], unique: ["email"] },
      {
        name: "accounts",
        dbName: "account",
        primaryKey: ["provider", "providerAccountId"],
        ids: [],
        unique: [],
      },
    ]);
    expect(schema.relations.map((r) => [r.from.model, r.to.model, r.onDelete])).toStrictEqual([
      ["users", "accounts", "cascade"],
    ]);
  });
});
