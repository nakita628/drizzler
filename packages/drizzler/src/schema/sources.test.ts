import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { isSchemaModule } from "./paths.js";
import {
  collectSchemaFiles,
  drizzleConfigSchema,
  expandInput,
  readSchemaSources,
  resolveImport,
} from "./sources.js";

let dir = "";

function write(file: string, text: string) {
  const full = path.join(dir, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, text);
  return full;
}

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "drizzler-sources-")));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("isSchemaModule", () => {
  it.each([
    ["user.sql.ts", true],
    ["schema.mts", true],
    ["schema.js", true],
    ["user.test.ts", false],
    ["user.spec.ts", false],
    ["types.d.ts", false],
    ["README.md", false],
  ])("%s → %s", (file, expected) => {
    expect(isSchemaModule(file)).toBe(expected);
  });
});

describe("expandInput", () => {
  it("expands a directory into its schema modules, tests and node_modules left out", () => {
    write("db/a.ts", "");
    write("db/nested/b.ts", "");
    write("db/a.test.ts", "");
    write("db/node_modules/c.ts", "");
    expect(Effect.runSync(expandInput("db", dir))).toStrictEqual([
      path.join(dir, "db/a.ts"),
      path.join(dir, "db/nested/b.ts"),
    ]);
  });

  it("expands a glob, as drizzle-kit's schema is written", () => {
    write("schema/user.sql.ts", "");
    write("schema/post.sql.ts", "");
    write("schema/columns.helpers.ts", "");
    expect(Effect.runSync(expandInput("./schema/*.sql.ts", dir))).toStrictEqual([
      path.join(dir, "schema/post.sql.ts"),
      path.join(dir, "schema/user.sql.ts"),
    ]);
  });

  it("names the input that is missing or matches nothing", () => {
    const missing = Effect.runSync(Effect.flip(expandInput("nope.ts", dir)));
    expect([missing._tag, missing.message]).toStrictEqual([
      "SchemaInputError",
      "nope.ts does not exist",
    ]);
    const unmatched = Effect.runSync(Effect.flip(expandInput("x/*.ts", dir)));
    expect(unmatched.message).toBe("x/*.ts matches no schema file");
  });
});

describe("resolveImport", () => {
  it("resolves relative imports, .js to .ts, index modules and tsconfig paths", () => {
    write("tsconfig.json", `{ "compilerOptions": { "paths": { "#/*": ["./src/*"] } } }`);
    const user = write("src/db/user.ts", "");
    const index = write("src/db/index.ts", "");
    const from = write("src/db/post.ts", "");
    expect(resolveImport("./user.js", from)).toBe(user);
    expect(resolveImport("./user", from)).toBe(user);
    expect(resolveImport(".", from)).toBe(index);
    expect(resolveImport("#/db/user.js", from)).toBe(user);
    expect(resolveImport("drizzle-orm/pg-core", from)).toBeNull();
  });
});

describe("collectSchemaFiles and readSchemaSources", () => {
  it("follows the helpers and relations a schema imports, and reads them as one", () => {
    write("tsconfig.json", `{ "compilerOptions": { "paths": { "#/*": ["./src/*"] } } }`);
    write(
      "src/schema/columns.helpers.ts",
      `import { timestamp } from "drizzle-orm/pg-core";\nconst timestamps = { createdAt: timestamp() };\nexport { timestamps };\n`,
    );
    const user = write(
      "src/schema/user.sql.ts",
      `import { pgTable, text } from "drizzle-orm/pg-core";\nimport { timestamps } from "#/schema/columns.helpers.js";\nimport type { X } from "./types.js";\nconst user = pgTable("user", { id: text().primaryKey(), ...timestamps });\nexport { user };\n`,
    );
    write("src/schema/types.ts", "export type X = 1;\n");

    const files = Effect.runSync(collectSchemaFiles(["src/schema/*.sql.ts"], dir));
    expect(files).toStrictEqual([user, path.join(dir, "src/schema/columns.helpers.ts")]);
    expect(Effect.runSync(readSchemaSources(files))).toStrictEqual([
      `const user = pgTable("user", { id: text().primaryKey(), ...timestamps });`,
      "export { user };",
      "",
      "",
      "const timestamps = { createdAt: timestamp() };",
      "export { timestamps };",
      "",
    ]);
  });
});

describe("drizzleConfigSchema", () => {
  it("reads the schema of drizzle.config.ts without running it", () => {
    write(
      "drizzle.config.ts",
      `import { defineConfig } from "drizzle-kit";\nexport default defineConfig({ dialect: "postgresql", schema: "./src/schema/*.sql.ts" });\n`,
    );
    expect(Effect.runSync(drizzleConfigSchema(dir))).toStrictEqual({
      file: path.join(dir, "drizzle.config.ts"),
      inputs: ["./src/schema/*.sql.ts"],
    });
  });

  it("reads a list, and a config object kept in a const", () => {
    write(
      "drizzle.config.ts",
      `const config = { schema: ["./a.ts", "./b.ts"] } satisfies Config;\nexport default config;\n`,
    );
    expect(Effect.runSync(drizzleConfigSchema(dir))?.inputs).toStrictEqual(["./a.ts", "./b.ts"]);
  });

  it("is null without a config, or with a schema it cannot read statically", () => {
    expect(Effect.runSync(drizzleConfigSchema(dir))).toBeNull();
    write("drizzle.config.ts", `export default { schema: process.env.SCHEMA };\n`);
    expect(Effect.runSync(drizzleConfigSchema(dir))).toBeNull();
  });
});
