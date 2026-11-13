import { describe, expect, it } from "vite-plus/test";
import { descriptionBefore, parseSource } from "./ast.js";

/** The description the comment above `marker` gives, in `lines`. */
function described(lines: readonly string[], marker: string) {
  const source = parseSource(lines);
  return descriptionBefore(source, source.text.indexOf(marker));
}

describe("descriptionBefore", () => {
  it("reads a JSDoc block, a // line and a /// line alike", () => {
    const code = [
      "export const user = pgTable('user', {",
      "  /** The key */",
      "  id: uuid('id'),",
      "  // Where mail goes",
      "  email: text('email'),",
      "  /// Shown on the profile",
      "  bio: text('bio'),",
      "})",
    ];
    expect(described(code, "id:")).toBe("The key");
    expect(described(code, "email:")).toBe("Where mail goes");
    expect(described(code, "bio:")).toBe("Shown on the profile");
  });

  it("joins the lines of a block and of a run of // lines into one", () => {
    const code = [
      "/**",
      " * Everyone who can sign in.",
      " * Deleted users stay, marked.",
      " */",
      "export const user = pgTable('user', {",
      "  // first",
      "  // second",
      "  id: uuid('id'),",
      "})",
    ];
    expect(described(code, "export const user")).toBe(
      "Everyone who can sign in. Deleted users stay, marked.",
    );
    expect(described(code, "id:")).toBe("first second");
  });

  it("leaves the @ tags out, and is null for a comment of tags alone", () => {
    const code = [
      "/**",
      " * Posts.",
      " * @see https://orm.drizzle.team",
      " */",
      "export const post = pgTable('post', {",
      "  /** @deprecated */",
      "  id: uuid('id'),",
      "})",
    ];
    expect(described(code, "export const post")).toBe("Posts.");
    expect(described(code, "id:")).toBeNull();
  });

  it("does not take a comment across a blank line, or one that ends a line of code", () => {
    const code = [
      "// A file header",
      "",
      "export const user = pgTable('user', {",
      "  id: uuid('id'), // the key",
      "  email: text('email'),",
      "})",
    ];
    expect(described(code, "export const user")).toBeNull();
    expect(described(code, "email:")).toBeNull();
  });
});
