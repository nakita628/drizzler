import { describe, expect, it } from "vite-plus/test";
import { mergeRelations } from "./merge-relations.js";

describe("mergeRelations", () => {
  it("maps an inferred required FK to one / many, identifying, origin inferred", () => {
    const code = [
      "export const user = mysqlTable('user', {",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "})",
      "export const post = mysqlTable('post', {",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "  userId: varchar('user_id', { length: 36 }).notNull().references(() => user.id),",
      "})",
    ];
    expect(mergeRelations(code)).toStrictEqual([
      {
        from: { model: "user", field: "id", cardinality: "one" },
        to: { model: "post", field: "userId", cardinality: "many" },
        identifying: true,
        origin: "inferred",
      },
    ]);
  });

  it("maps a nullable inferred FK to one / zero-many", () => {
    const code = [
      "export const user = mysqlTable('user', {",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "})",
      "export const post = mysqlTable('post', {",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "  userId: varchar('user_id', { length: 36 }).references(() => user.id),",
      "})",
    ];
    expect(mergeRelations(code)).toStrictEqual([
      {
        from: { model: "user", field: "id", cardinality: "one" },
        to: { model: "post", field: "userId", cardinality: "zero-many" },
        identifying: true,
        origin: "inferred",
      },
    ]);
  });

  it("maps a defineRelations-only pair (no FK) to a non-identifying relation, origin relations", () => {
    const code = [
      "export const User = sqliteTable('User', {",
      "  id: text('id').notNull().primaryKey(),",
      "})",
      "export const Profile = sqliteTable('Profile', {",
      "  id: text('id').notNull().primaryKey(),",
      "  user_id: text('user_id'),",
      "})",
      "export const profileRelations = defineRelations({ Profile, User }, (r) => ({",
      "  Profile: {",
      "    user: r.one.User({ from: r.Profile.user_id, to: r.User.id }),",
      "  },",
      "}))",
    ];
    expect(mergeRelations(code)).toStrictEqual([
      {
        from: { model: "User", field: "id", cardinality: "one" },
        to: { model: "Profile", field: "user_id", cardinality: "zero-many" },
        identifying: false,
        origin: "relations",
      },
    ]);
  });

  it("keeps a defineRelations pair a FK also backs as the FK (origin inferred)", () => {
    const code = [
      "export const user = mysqlTable('user', {",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "})",
      "export const post = mysqlTable('post', {",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "  userId: varchar('user_id', { length: 36 }).notNull().references(() => user.id),",
      "})",
      "export const postRelations = defineRelations({ post, user }, (r) => ({",
      "  post: {",
      "    user: r.one.user({ from: r.post.userId, to: r.user.id }),",
      "  },",
      "}))",
    ];
    expect(mergeRelations(code)).toStrictEqual([
      {
        from: { model: "user", field: "id", cardinality: "one" },
        to: { model: "post", field: "userId", cardinality: "many" },
        identifying: true,
        origin: "inferred",
      },
    ]);
  });

  it("preserves the source order of multiple inferred FKs", () => {
    const code = [
      "export const user = mysqlTable('user', {",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "})",
      "export const post = mysqlTable('post', {",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "  userId: varchar('user_id', { length: 36 }).notNull().references(() => user.id),",
      "})",
      "export const comment = mysqlTable('comment', {",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "  postId: varchar('post_id', { length: 36 }).notNull().references(() => post.id),",
      "})",
    ];
    expect(mergeRelations(code)).toStrictEqual([
      {
        from: { model: "user", field: "id", cardinality: "one" },
        to: { model: "post", field: "userId", cardinality: "many" },
        identifying: true,
        origin: "inferred",
      },
      {
        from: { model: "post", field: "id", cardinality: "one" },
        to: { model: "comment", field: "postId", cardinality: "many" },
        identifying: true,
        origin: "inferred",
      },
    ]);
  });

  it("orders FK relations first and appends defineRelations-only ones last", () => {
    const code = [
      "export const articleRelations = defineRelations({ Article, Tag }, (r) => ({",
      "  Article: {",
      "    tag: r.one.Tag({ from: r.Article.tag_id, to: r.Tag.id }),",
      "  },",
      "}))",
      "export const user = mysqlTable('user', {",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "})",
      "export const Article = mysqlTable('Article', {",
      "  id: varchar('id', { length: 36 }).primaryKey(),",
      "  userId: varchar('user_id', { length: 36 }).notNull().references(() => user.id),",
      "  tag_id: varchar('tag_id', { length: 36 }).notNull(),",
      "})",
    ];
    expect(mergeRelations(code)).toStrictEqual([
      {
        from: { model: "user", field: "id", cardinality: "one" },
        to: { model: "Article", field: "userId", cardinality: "many" },
        identifying: true,
        origin: "inferred",
      },
      {
        from: { model: "Tag", field: "id", cardinality: "one" },
        to: { model: "Article", field: "tag_id", cardinality: "many" },
        identifying: false,
        origin: "relations",
      },
    ]);
  });
});
