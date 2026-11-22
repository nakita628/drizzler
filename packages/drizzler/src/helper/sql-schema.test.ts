import { describe, expect, it } from "vite-plus/test";
import { sqlSchema } from "./sql-schema.js";

describe("sqlSchema", () => {
  it("maps column builders to their SQL types", () => {
    const { tables } = sqlSchema([
      "export const metric = pgTable('metric', {",
      "  id: serial('id').primaryKey(),",
      "  total: integer('total'),",
      "  count: int('count').notNull(),",
      "  ratio: doublePrecision('ratio'),",
      "  at: timestamp('at', { withTimezone: true }),",
      "  label: citext('label'),",
      "})",
    ]);

    expect(tables).toHaveLength(1);
    expect(tables[0]?.columns.map((c) => [c.name, c.type])).toStrictEqual([
      ["id", "serial"],
      ["total", "integer"],
      ["count", "integer"],
      ["ratio", "double precision"],
      ["at", "timestamptz"],
      // A builder not in SQL_TYPES keeps its own name as its type.
      ["label", "citext"],
    ]);
  });

  it("types a column of an enum declared on a database schema by the enum and its schema", () => {
    const [table] = sqlSchema([
      "export const authSchema = pgSchema('auth')",
      "export const role = authSchema.enum('user_role', ['admin', 'member'])",
      // A dot in the name of an enum of the default schema is part of the name.
      "export const kind = pgEnum('my.kind', ['a', 'b'])",
      "export const users = authSchema.table('users', {",
      "  role: role('role').notNull(),",
      "  kind: kind('kind'),",
      "})",
    ]).tables;

    expect(table?.columns.map((c) => [c.name, c.type, c.typeSchema])).toStrictEqual([
      ["role", "user_role", "auth"],
      ["kind", "my.kind", null],
    ]);
  });

  it("marks the serial types as generated, but no enum or custom type named after them", () => {
    const [table] = sqlSchema([
      "const serialized = customType({ dataType() { return 'serialized_json' } })",
      "const legacySerial = customType({ dataType() { return 'BIGSERIAL' } })",
      "export const serialKind = pgEnum('serial_kind', ['a', 'b'])",
      "export const item = pgTable('item', {",
      "  id: bigserial('id', { mode: 'number' }).primaryKey(),",
      "  rank: smallserial('rank'),",
      "  legacyId: legacySerial('legacy_id'),",
      "  kind: serialKind('kind'),",
      "  payload: serialized('payload'),",
      "})",
    ]).tables;

    expect(table?.columns.map((c) => [c.name, c.type, c.increment])).toStrictEqual([
      ["id", "bigserial", true],
      ["rank", "smallserial", true],
      // SQL reads a type in any case.
      ["legacy_id", "BIGSERIAL", true],
      ["kind", "serial_kind", false],
      ["payload", "serialized_json", false],
    ]);
  });
});

describe("sqlSchema relations", () => {
  const code = [
    "export const authSchema = pgSchema('auth')",
    "export const role = pgEnum('user_role', ['admin', 'member'])",
    "export const users = authSchema.table('users', {",
    "  id: uuid('id').primaryKey(),",
    "  role: role('role').notNull(),",
    "})",
    "export const profile = pgTable('profile', {",
    "  userId: uuid('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),",
    "})",
    "export const posts = pgTable('posts', {",
    "  authorId: uuid('author_id').references(() => users.id),",
    "})",
  ];

  it("names tables by their schema and enums by their SQL name", () => {
    const { tables } = sqlSchema(code);

    expect(tables.map((t) => [t.name, t.schema, t.bareName])).toStrictEqual([
      ["auth.users", "auth", "users"],
      ["profile", null, "profile"],
      ["posts", null, "posts"],
    ]);
    expect(tables[0]?.columns[1]?.type).toBe("user_role");
    expect(tables[1]?.columns).toStrictEqual([
      {
        name: "user_id",
        type: "uuid",
        typeSchema: null,
        primaryKey: false,
        increment: false,
        notNull: true,
        unique: true,
        foreignKey: true,
        note: null,
      },
    ]);
  });

  it("gives each relation its SQL ends and cardinality", () => {
    const { relations } = sqlSchema(code);
    const users = {
      table: "auth.users",
      schema: "auth",
      bareTable: "users",
      column: "id",
      columns: ["id"],
      cardinality: "one",
    };

    expect(relations).toStrictEqual([
      {
        origin: "inferred",
        onDelete: "cascade",
        onUpdate: null,
        constraintName: null,
        from: users,
        // A unique foreign key is one-to-one.
        to: {
          table: "profile",
          schema: null,
          bareTable: "profile",
          column: "user_id",
          columns: ["user_id"],
          cardinality: "one",
        },
      },
      {
        origin: "inferred",
        onDelete: null,
        onUpdate: null,
        constraintName: null,
        from: users,
        // A nullable, non-unique foreign key is zero-to-many.
        to: {
          table: "posts",
          schema: null,
          bareTable: "posts",
          column: "author_id",
          columns: ["author_id"],
          cardinality: "zero-many",
        },
      },
    ]);
  });
});

describe("sqlSchema keys", () => {
  it("makes a composite key a table index of NOT NULL columns by their SQL names", () => {
    const [table] = sqlSchema([
      "export const membership = pgTable('membership', {",
      "  userId: uuid('user_id'),",
      "  groupId: uuid('group_id'),",
      "}, (t) => [primaryKey({ columns: [t.userId, t.groupId] })])",
    ]).tables;

    expect(table?.columns.map((c) => [c.name, c.primaryKey, c.notNull])).toStrictEqual([
      ["user_id", false, true],
      ["group_id", false, true],
    ]);
    expect(table?.indexes).toStrictEqual([
      { kind: "pk", columns: ["user_id", "group_id"], name: null, using: null, expression: null },
    ]);
  });
});
