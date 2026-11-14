import { describe, expect, it } from "vite-plus/test";
import type { QueryExample } from "./query-examples.js";
import { makeProbeModule, readProbeResult } from "./query-probe.js";

const examples = [
  { table: "users", title: "All users", code: "db.select().from(users)" },
  { table: "posts", title: "One post", code: "db.select().from(posts).limit(1)" },
] as unknown as readonly QueryExample[];

describe("makeProbeModule", () => {
  it("imports each schema file, the dialect's proxy and kit, and builds every example", () => {
    const source = makeProbeModule({
      dialect: "pg",
      fileUrls: ["file:///app/a.ts", "file:///app/b.ts"],
      examples,
    });
    expect(source).toContain('import { drizzle as __drizzle } from "drizzle-orm/pg-proxy";');
    expect(source).toContain('import * as __s0 from "file:///app/a.ts";');
    expect(source).toContain('import * as __s1 from "file:///app/b.ts";');
    expect(source).toContain("const __schema = Object.assign({}, __s0, __s1);");
    expect(source).toContain("const { users, posts } = __schema;");
    expect(source).toContain("  __sql(() => db.select().from(posts).limit(1)),");
    expect(source).toContain('await import("drizzle-kit/payload/postgres")');
  });
});

describe("readProbeResult", () => {
  const built = [
    { sql: "select * from users", params: [], error: null },
    { sql: "select * from posts limit $1", params: [1], error: null },
  ];

  it("pairs each example with its SQL, and reads the DDL", () => {
    expect(
      readProbeResult(
        { default: built, ddl: { statements: ["CREATE TABLE users"], error: null } },
        examples,
      ),
    ).toStrictEqual({
      queries: [
        { ...examples[0], ...built[0] },
        { ...examples[1], ...built[1] },
      ],
      ddl: { statements: ["CREATE TABLE users"], error: null },
    });
  });

  it("says when drizzle-kit gave no statements, and is null without one query per example", () => {
    expect(readProbeResult({ default: built, ddl: null }, examples)?.ddl).toStrictEqual({
      statements: [],
      error: "drizzle-kit did not give back the statements",
    });
    expect(readProbeResult({ default: built.slice(1) }, examples)).toBeNull();
    expect(readProbeResult(null, examples)).toBeNull();
  });
});
