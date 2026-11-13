import { describe, expect, it } from "vite-plus/test";
import { diagramSchema } from "../helper/index.js";
import { neighborhood } from "./er.js";

const schema = diagramSchema([
  "export const role = pgEnum('role', ['admin', 'member'])",
  "export const status = pgEnum('status', ['open', 'closed'])",
  "export const org = pgTable('org', { id: uuid('id').primaryKey() })",
  "export const user = pgTable('user', {",
  "  id: uuid('id').primaryKey(),",
  "  orgId: uuid('org_id').notNull().references(() => org.id),",
  "  role: role('role').notNull(),",
  "})",
  "export const post = pgTable('post', {",
  "  id: uuid('id').primaryKey(),",
  "  authorId: uuid('author_id').notNull().references(() => user.id),",
  "  status: status('status').notNull(),",
  "})",
  "export const log = pgTable('log', { id: uuid('id').primaryKey() })",
]);

describe("neighborhood", () => {
  it("keeps a table, the tables a relation joins it to, and the relations that touch it", () => {
    const around = neighborhood(schema, "user");
    expect(around.models.map((m) => m.name)).toStrictEqual(["org", "user", "post"]);
    expect(around.relations.map((r) => `${r.from.model}->${r.to.model}`)).toStrictEqual([
      "org->user",
      "user->post",
    ]);
  });

  it("keeps the enums its tables hold, and nothing two steps away", () => {
    expect(neighborhood(schema, "org").models.map((m) => m.name)).toStrictEqual(["org", "user"]);
    expect(neighborhood(schema, "org").enums.map((e) => e.name)).toStrictEqual(["role"]);
    expect(neighborhood(schema, "user").enums.map((e) => e.name)).toStrictEqual(["role", "status"]);
  });

  it("keeps a table with no relation alone", () => {
    const around = neighborhood(schema, "log");
    expect(around.models.map((m) => m.name)).toStrictEqual(["log"]);
    expect(around.relations).toStrictEqual([]);
  });
});
