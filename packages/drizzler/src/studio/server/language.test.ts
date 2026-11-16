import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import studio from "./index.js";
import type { z } from "@hono/zod-openapi";
import {
  CompletionDetailSchema,
  CompletionsSchema,
  DiagnosticsSchema,
  HoverSchema,
  LanguageStatusSchema,
  SignatureHelpSchema,
} from "./routes/index.js";
import { configureStudio, connectDatabase } from "./usecases/studio.js";

const BASE = "http://127.0.0.1";

// The body of a response, checked against the schema the API declares for it.
async function read<T>(schema: z.ZodType<T>, response: Response | Promise<Response>): Promise<T> {
  return schema.parse(await (await response).json());
}

const schema = `import { pgTable, text, uuid } from "drizzle-orm/pg-core";

export const user = pgTable("users", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
});
`;

async function studioOn(dir: string) {
  const file = path.join(dir, "schema.ts");
  fs.writeFileSync(file, schema);
  const database = await Effect.runPromise(connectDatabase({ url: null, cwd: dir }));
  configureStudio({ schemaPath: file, cwd: dir, database });
  const api = studio;
  return (url: string, body?: unknown) =>
    api.request(`${BASE}${url}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
}

// Inside the package, so the project's typescript and drizzle-orm resolve as they would in an app.
describe("the editor's TypeScript", () => {
  let dir: string;
  let request: Awaited<ReturnType<typeof studioOn>>;

  // The first question reads drizzle-orm's types; on a slow machine (CI) that
  // alone takes seconds, so it is asked here, with room, and not in a test.
  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(import.meta.dirname, ".language-"));
    request = await studioOn(dir);
    await request("/api/language/diagnostics", { source: schema });
  }, 60_000);

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("loads the project's TypeScript", async () => {
    const status = await read(LanguageStatusSchema, request("/api/language"));
    expect(status.reason).toBeNull();
    expect(status.typescript).toMatch(/^\d+\.\d+/u);
  });

  it("completes the column builder methods from drizzle-orm's types", async () => {
    const source = schema.replace('text("name").notNull()', 'text("name").');
    const offset = source.indexOf('text("name").') + 'text("name").'.length;
    const { items } = await read(
      CompletionsSchema,
      request("/api/language/complete", { source, offset }),
    );
    const labels = items.map((item) => item.label);
    expect(labels).toStrictEqual(
      expect.arrayContaining(["notNull", "default", "references", "unique"]),
    );
  });

  it("completes what the module exports inside an import", async () => {
    const source = schema.replace("pgTable, text, uuid", "pgTable, text, uuid, ");
    const offset = source.indexOf("uuid, ") + "uuid, ".length;
    const { items } = await read(
      CompletionsSchema,
      request("/api/language/complete", { source, offset }),
    );
    expect(items.map((item) => item.label)).toStrictEqual(
      expect.arrayContaining(["varchar", "integer", "pgEnum", "boolean"]),
    );
  });

  it("describes a completion, shows a hover and the signature of a call", async () => {
    const offset = schema.indexOf("notNull") + 2;
    const detail = await read(
      CompletionDetailSchema,
      request("/api/language/complete/detail", { source: schema, offset, name: "notNull" }),
    );
    expect(detail.detail).toContain("notNull");

    const hover = await read(
      HoverSchema,
      request("/api/language/hover", { source: schema, offset }),
    );
    expect(hover.contents).toContain("notNull");
    expect(schema.slice(hover.range?.start, hover.range?.end)).toBe("notNull");

    const callOffset = schema.indexOf('pgTable("users", ') + 'pgTable("users", '.length;
    const help = await read(
      SignatureHelpSchema,
      request("/api/language/signature", { source: schema, offset: callOffset }),
    );
    expect(help.signatures.length).toBeGreaterThan(0);
    expect(help.activeParameter).toBe(1);
  });

  it("reports type errors, and none for a schema that checks", async () => {
    const clean = await read(
      DiagnosticsSchema,
      request("/api/language/diagnostics", { source: schema }),
    );
    expect(clean.diagnostics).toStrictEqual([]);

    const typo = schema.replace(".notNull()", ".notNul()");
    const { diagnostics } = await read(
      DiagnosticsSchema,
      request("/api/language/diagnostics", { source: typo }),
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]?.severity).toBe("error");
    expect(typo.slice(diagnostics[0]?.range.start, diagnostics[0]?.range.end)).toBe("notNul");
  });
});

describe("without TypeScript", () => {
  it("says why, and answers 503 so the editor goes on without completion", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drizzler-language-"));
    try {
      const request = await studioOn(dir);
      const status = await read(LanguageStatusSchema, request("/api/language"));
      expect(status.typescript).toBeNull();
      expect(status.reason).toContain('Cannot load "typescript"');
      const res = await request("/api/language/complete", { source: schema, offset: 0 });
      expect(res.status).toBe(503);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
