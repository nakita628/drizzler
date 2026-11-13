import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { SQLITE_SCHEMA } from "./fixtures.ts";
import { EXAMPLES, drizzler, makeProject, packageVersion, removeProject } from "./helpers.ts";

const LAYERED = path.join(EXAMPLES, "layered");
const LAYERED_SCHEMA = "src/adapter/secondary/persistence/rdb/schema";

let out = "";

beforeEach(() => {
  out = makeProject({});
});

afterEach(() => {
  removeProject(out);
});

describe("drizzler, the packaged command", () => {
  it("prints the version of the package", async () => {
    const { code, output } = await drizzler(["--version"], out);
    expect(code).toBe(0);
    expect(output).toBe(`drizzler v${packageVersion()}`);
  });

  it("shows its usage when there is no schema to read", async () => {
    const { code, output } = await drizzler([], out);
    expect(code).toBe(0);
    expect(output).toContain("USAGE");
    expect(output).toContain("studio");
    expect(output).toContain("seed");
  });
});

describe("a schema split over files (examples/layered)", () => {
  it("reads the schema of drizzle.config.ts when no input is given", async () => {
    const output = path.join(out, "ER.md");
    const result = await drizzler(["-o", output], LAYERED);
    expect(result).toStrictEqual({ code: 0, output: `💧 Generated Mermaid ER at: ${output}` });

    const mermaid = fs.readFileSync(output, "utf8");
    // A foreign key is solid; a relation only defineRelations declares is dashed; a child column
    // that is its table's key is a one-to-one.
    expect(mermaid).toContain('cartTable ||--|{ cartItemTable : "(customerId) - (customerId)"');
    expect(mermaid).toContain('productTable ||..|{ orderItemTable : "(productId) - (productId)"');
    expect(mermaid).toContain('customerTable ||..|| cartTable : "(customerId) - (customerId)"');
    // Columns spread from the helper module, with their comments, and a table with no relation.
    expect(mermaid).toContain('timestamp createdAt "When the row was inserted"');
    expect(mermaid).toContain("domainEventTable {");
  });

  it("reads a directory, following the helper it imports through a tsconfig path", async () => {
    const output = path.join(out, "schema.dbml");
    const { code } = await drizzler([LAYERED_SCHEMA, "-o", output], LAYERED);
    expect(code).toBe(0);
    const dbml = fs.readFileSync(output, "utf8");
    expect(dbml).toContain("Table cartItemTable {");
    expect(dbml).toContain("updatedAt timestamp [note: 'When the row was last changed']");
    expect(dbml).toContain("Ref cartItemTable_productId_productTable_productId");
  });

  it("reads a glob, as drizzle-kit's schema is written", async () => {
    const output = path.join(out, "ER.md");
    const { code } = await drizzler([`${LAYERED_SCHEMA}/cart*.sql.ts`, "-o", output], LAYERED);
    expect(code).toBe(0);
    const mermaid = fs.readFileSync(output, "utf8");
    expect(mermaid).toContain("cartItemTable {");
    expect(mermaid).not.toContain("orderTable {");
  });

  it("writes the docs into a directory: the table specification and every diagram", async () => {
    const docs = path.join(out, "docs");
    const result = await drizzler(["-o", `${docs}/`], LAYERED);
    expect(result).toStrictEqual({
      code: 0,
      output: `💧 Generated docs (README.md, er.svg, tables/*.svg) at: ${docs}/`,
    });
    expect(fs.readdirSync(docs).toSorted()).toStrictEqual(["README.md", "er.svg", "tables"]);
    // A diagram per table with a relation; domainEventTable has none.
    expect(fs.readdirSync(path.join(docs, "tables")).toSorted()).toStrictEqual([
      "cartItemTable.svg",
      "cartTable.svg",
      "customerTable.svg",
      "orderItemTable.svg",
      "orderTable.svg",
      "productTable.svg",
    ]);
    const readme = fs.readFileSync(path.join(docs, "README.md"), "utf8");
    expect(readme).toContain("![ER diagram](er.svg)");
    // The tables are padded to their widest cell, as the formatter writes Markdown.
    expect(readme).toMatch(
      /\| \[cartItemTable\]\(#table-cartItemTable\) +\| `cart_item` +\| A line of a cart +\|/u,
    );
    expect(readme).toMatch(
      /\| `createdAt` +\| `timestamp` +\| NOT NULL +\| `\.defaultNow\(\)` +\| When the row was inserted +\|/u,
    );
    expect(readme).toContain(
      "- `productId` → [productTable.productId](#table-productTable) (many to one, defineRelations, no foreign key)",
    );
    expect(readme).toContain("![orderTable and the tables it relates to](tables/orderTable.svg)");
    // Each query beside the SQL drizzle-orm builds for it, from the schema loaded through its
    // tsconfig path imports; columns are named as snakeCase.table names them.
    expect(readme).toContain("<summary>Queries and their SQL</summary>");
    expect(readme).toContain(
      '```sql\ndelete from "order"\nwhere "order"."order_id" = $1\n-- params: ["orderId"]\n```',
    );
    expect(readme).toContain("left join lateral");
    // Each table's definition as drizzle-kit writes it, its foreign key with it.
    expect(readme).toMatch(
      /#### Definition\n\n```sql\nCREATE TABLE "cart_item" \([\s\S]*?\);\n\nALTER TABLE "cart_item" ADD CONSTRAINT "[^"]+" FOREIGN KEY \("customer_id"\) REFERENCES "cart"\("customer_id"\) ON DELETE RESTRICT ON UPDATE RESTRICT;\n```/u,
    );
    // The whole schema as SQL, folded, at the top.
    expect(readme).toContain(
      '<details>\n<summary>The whole schema as SQL</summary>\n\n```sql\nCREATE TABLE "cart" (',
    );
    const orderDiagram = fs.readFileSync(path.join(docs, "tables/orderTable.svg"), "utf8");
    expect(orderDiagram).toContain("order_item");
    expect(orderDiagram).not.toContain("cart_item");
    expect(fs.readFileSync(path.join(docs, "er.svg"), "utf8").startsWith("<svg")).toBe(true);
  });

  it("removes the diagram of a table that is gone when the docs are written again", async () => {
    const docs = path.join(out, "docs");
    fs.mkdirSync(path.join(docs, "tables"), { recursive: true });
    fs.writeFileSync(path.join(docs, "tables/goneTable.svg"), "<svg/>");
    fs.writeFileSync(path.join(docs, "tables/notes.txt"), "kept");
    expect((await drizzler(["-o", docs], LAYERED)).code).toBe(0);
    expect(fs.existsSync(path.join(docs, "tables/goneTable.svg"))).toBe(false);
    expect(fs.existsSync(path.join(docs, "tables/notes.txt"))).toBe(true);
  });

  it("draws the ER diagram as SVG and as PNG, light and dark", async () => {
    const svg = path.join(out, "er.svg");
    const png = path.join(out, "er-dark.png");
    expect((await drizzler(["-o", svg], LAYERED)).code).toBe(0);
    expect((await drizzler(["-o", png, "--theme", "dark"], LAYERED)).code).toBe(0);
    const drawn = fs.readFileSync(svg, "utf8");
    expect(drawn.startsWith("<svg")).toBe(true);
    expect(drawn).toContain("cart_item");
    expect([...fs.readFileSync(png).subarray(0, 4)]).toStrictEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});

describe("the docs' SQL, as drizzle-orm builds it", () => {
  it("is written in the schema's dialect", async () => {
    const project = makeProject({ "schema.ts": SQLITE_SCHEMA });
    const { code, output } = await drizzler(["schema.ts", "-o", "docs"], project);
    const readme = fs.readFileSync(path.join(project, "docs/README.md"), "utf8");
    removeProject(project);
    expect(code).toBe(0);
    expect(output).not.toContain("without their SQL");
    expect(readme).toContain(
      '```sql\ndelete from "posts"\nwhere "posts"."id" = ?\n-- params: [1]\n```',
    );
    expect(readme).toContain("json_group_array");
    expect(readme).toContain("#### Definition\n\n```sql\nCREATE TABLE `posts` (");
  });

  it("is left out, with the reason, when the schema cannot be loaded", async () => {
    const project = makeProject({
      "schema.ts": `${SQLITE_SCHEMA}\nthrow new Error("the schema refuses to load");\n`,
    });
    const { code, output } = await drizzler(["schema.ts", "-o", "docs"], project);
    const readme = fs.readFileSync(path.join(project, "docs/README.md"), "utf8");
    removeProject(project);
    expect(code).toBe(0);
    expect(output).toContain(
      "The queries and tables are shown without their SQL: the schema refuses to load",
    );
    expect(readme).toContain("<summary>Queries</summary>");
    expect(readme).not.toContain("```sql");
  });

  it("keeps the queries' SQL but leaves the definitions out without drizzle-kit", async () => {
    // Outside test/, so only the drizzle-orm linked here resolves, not test's drizzle-kit.
    const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "drizzler-no-kit-")));
    fs.mkdirSync(path.join(project, "node_modules"));
    fs.symlinkSync(
      fs.realpathSync(path.join(import.meta.dirname, "node_modules/drizzle-orm")),
      path.join(project, "node_modules/drizzle-orm"),
    );
    fs.writeFileSync(path.join(project, "schema.ts"), SQLITE_SCHEMA);
    const { code, output } = await drizzler(["schema.ts", "-o", "docs"], project);
    const readme = fs.readFileSync(path.join(project, "docs/README.md"), "utf8");
    fs.rmSync(project, { recursive: true, force: true });
    expect(code).toBe(0);
    expect(output).toContain(
      "The tables are shown without their SQL definitions: drizzle-kit is not installed in the project",
    );
    expect(readme).toContain("<summary>Queries and their SQL</summary>");
    expect(readme).not.toContain("#### Definition");
    expect(readme).not.toContain("The whole schema as SQL");
  });
});

describe("a command line drizzler cannot run", () => {
  it.each([
    [["missing.ts", "-o", "out.dbml"], "missing.ts does not exist"],
    [["schema.ts", "-o", "out.txt"], "Unsupported output format: out.txt"],
    [["schema.ts"], "Missing -o flag"],
    [["src/*.ts", "-o", "out.dbml"], "matches no schema file"],
  ])("drizzler %s exits with 1 and says why", async (args, message) => {
    const project = makeProject({ "schema.ts": "export const x = 1;\n" });
    const { code, output } = await drizzler(args, project);
    removeProject(project);
    expect(code).toBe(1);
    expect(output).toContain(message);
  });
});
