import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
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
