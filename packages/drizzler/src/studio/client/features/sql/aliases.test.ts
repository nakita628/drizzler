import { describe, expect, it } from "vite-plus/test";
import { aliasesOf, fold, wordAround } from "./aliases.js";

const users = { name: "users", detail: "table user", columns: [] };
const posts = { name: "Post", detail: "table post", columns: [] };
const tables = [users, posts];

describe("aliasesOf", () => {
  it("reads each table and the alias it is given, with or without AS, quoted or not", () => {
    const aliases = aliasesOf('SELECT * FROM users u JOIN "Post" AS p ON p.user_id = u.id', tables);
    expect([...aliases.keys()].toSorted()).toStrictEqual(["p", "post", "u", "users"]);
    expect(aliases.get("u")).toBe(users);
    expect(aliases.get("p")).toBe(posts);
  });

  it("does not take a keyword that follows the table for an alias", () => {
    for (const sql of [
      "SELECT * FROM users WHERE id = 1",
      "SELECT * FROM users JOIN Post ON true",
      "SELECT * FROM users LEFT JOIN Post ON true",
      "UPDATE users SET name = 'a'",
      "INSERT INTO users VALUES (1)",
    ]) {
      expect([...aliasesOf(sql, tables).keys()]).not.toContain("where");
      expect(
        [...aliasesOf(sql, tables).keys()].some((key) =>
          ["join", "left", "set", "values"].includes(key),
        ),
      ).toBe(false);
    }
  });

  it("leaves out a table the schema does not have", () => {
    expect(aliasesOf("SELECT * FROM gone g", tables).size).toBe(0);
  });
});

describe("fold and wordAround", () => {
  it("compares names without their quotes, in lower case", () => {
    expect(fold('"Post"')).toBe("post");
    expect(fold("`users`")).toBe("users");
  });

  it("finds the word around a position", () => {
    expect(wordAround("SELECT u.email FROM", 10)).toStrictEqual({ start: 9, end: 14 });
    expect(wordAround("a + b", 2)).toStrictEqual({ start: 2, end: 2 });
  });
});
