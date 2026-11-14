// The custom rules run against small sources, as oxlint runs them: each node is visited with its
// `parent` set, `:exit` visitors after its children. Each case says what a rule reports, and what
// it must leave alone.
import { parseSync } from "oxc-parser";
import { describe, expect, it } from "vite-plus/test";
import plugin from "./custom.js";

function lint(name, code, filename = "packages/drizzler/src/studio/server/services/x.ts") {
  const rule = plugin.rules[name];
  const { program } = parseSync(filename, code, { lang: "ts", sourceType: "module" });
  const reports = [];
  const visitors = rule.create({
    filename,
    sourceCode: { text: code },
    report: (descriptor) => reports.push(descriptor),
  });
  function visit(node, parent) {
    if (!node || typeof node.type !== "string") return;
    Object.defineProperty(node, "parent", { value: parent, enumerable: false, configurable: true });
    visitors[node.type]?.(node);
    for (const key of Object.keys(node)) {
      const child = node[key];
      if (Array.isArray(child)) for (const each of child) visit(each, node);
      else if (child && typeof child.type === "string") visit(child, node);
    }
    visitors[`${node.type}:exit`]?.(node);
  }
  visit(program, null);
  return reports.length;
}

describe("no-lookup-in-loop", () => {
  it.each([
    ["a find by key in an outer list", "models.map((m) => relations.find((r) => r.to === m.name))"],
    ["an includes of a per-turn value", "names.filter((n) => !taken.includes(n))"],
    [
      "a find in an object's entries",
      "keys.map((k) => Object.entries(cols).find(([n]) => n === k))",
    ],
    [
      "a lookup in a for-of body",
      "for (const m of models) { relations.some((r) => r.to === m.name) }",
    ],
  ])("reports %s", (_, code) => {
    expect(lint("no-lookup-in-loop", code)).toBe(1);
  });

  it.each([
    ["a search of the item's own list", "models.map((m) => m.fields.find((f) => f.isId))"],
    ["a search by overlap, which has no key", "boxes.map((b) => cards.filter((c) => meets(b, c)))"],
    ["a lookup outside any loop", "relations.find((r) => r.to === name)"],
    ["the iterable of a for-of", "for (const r of relations.filter((r) => r.to === x)) use(r)"],
    ["a test file", "models.map((m) => relations.find((r) => r.to === m.name))"],
  ])("leaves alone %s", (label, code) => {
    const file = label === "a test file" ? "src/x.test.ts" : undefined;
    expect(lint("no-lookup-in-loop", code, file)).toBe(0);
  });
});

describe("no-accumulator-copy", () => {
  it.each([
    [
      "a spread of a part of the accumulator",
      "xs.reduce((s, x) => ({ rows: [...s.rows, x] }), init)",
    ],
    [
      "a spread of a destructured accumulator",
      "xs.reduce(({ rows }, x) => ({ rows: [...rows, x] }), init)",
    ],
  ])("reports %s", (_, code) => {
    expect(lint("no-accumulator-copy", code)).toBe(1);
  });

  it.each([
    ["a running number", "xs.reduce((sum, x) => sum + x, 0)"],
    ["a spread of the item", "xs.reduce((s, x) => ({ ...x, n: s.n + 1 }), init)"],
    ["a spread in a map", "xs.map((x) => [...x.parts])"],
  ])("leaves alone %s", (_, code) => {
    expect(lint("no-accumulator-copy", code)).toBe(0);
  });
});

describe("no-invariant-construction", () => {
  it("reports a Set built from values the loop does not change", () => {
    expect(lint("no-invariant-construction", "rows.filter((r) => new Set(ids).has(r.id))")).toBe(1);
  });

  it.each([
    ["a RegExp built from the item", 'rows.filter((r) => new RegExp(r.name, "u").test(s))'],
    [
      "a copy of a collection the loop fills",
      "while (go) { use(new Map(slots)); slots.set(k, 1) }",
    ],
    [
      "a Set inside an error's message",
      "for (const x of xs) fail(new XError(`${[...new Set(ys)]}`))",
    ],
    [
      "a Set built once, before the loop",
      "const s = new Set(ids); rows.filter((r) => s.has(r.id))",
    ],
  ])("leaves alone %s", (_, code) => {
    expect(lint("no-invariant-construction", code)).toBe(0);
  });
});

describe("promise-catch-must-log", () => {
  it("reports a .catch that drops the failure", () => {
    expect(lint("promise-catch-must-log", "client.end().catch(() => undefined)")).toBe(1);
  });

  it.each([
    ["a .catch that logs", 'p.catch((e) => Effect.logWarning("cannot close", e))'],
    ["a .catch that rethrows", "p.catch((e) => { throw e })"],
    ["Effect.catch, which catch-must-log checks", "Effect.catch(() => Effect.void)"],
  ])("leaves alone %s", (_, code) => {
    expect(lint("promise-catch-must-log", code)).toBe(0);
  });
});

describe("domain-no-nondeterminism and domain-no-side-effects", () => {
  it.each([
    ["domain-no-nondeterminism", "export function f() { return Date.now() }"],
    ["domain-no-nondeterminism", "export function f() { return new Date() }"],
    ["domain-no-nondeterminism", "export function f() { return Math.random() }"],
    ["domain-no-side-effects", "export function f() { console.log(1) }"],
    ["domain-no-side-effects", "export async function f() { return 1 }"],
    ["domain-no-side-effects", "let cache = 0"],
  ])("%s reports %s", (name, code) => {
    expect(lint(name, code)).toBe(1);
  });

  it.each([
    ["domain-no-nondeterminism", "export function f(at: number) { return new Date(at) }"],
    ["domain-no-side-effects", "const TABLE = new Map([[1, 2]])"],
  ])("%s leaves alone %s", (name, code) => {
    expect(lint(name, code)).toBe(0);
  });
});

describe("pure-no-throw", () => {
  const file = "packages/drizzler/src/sql/x.ts";

  it.each([
    ["a throw", 'export function f() { throw new Error("bad"); }'],
    ["a try", "export function f() { try { g(); } catch { return null; } }"],
    ["a JSON.parse", "export function f(text) { return JSON.parse(text); }"],
  ])("reports %s", (_, code) => {
    expect(lint("pure-no-throw", code, file)).toBe(1);
  });

  it.each([
    ["a failure returned as a value", 'export function f() { return { error: "bad" }; }'],
    ["JSON.stringify", "export function f(value) { return JSON.stringify(value); }"],
    ["a test file", 'throw new Error("bad");'],
  ])("leaves alone %s", (label, code) => {
    expect(lint("pure-no-throw", code, label === "a test file" ? "src/x.test.ts" : file)).toBe(0);
  });
});

describe("use-error-message", () => {
  const file = "packages/drizzler/src/core/x.ts";

  it("reports a hand-written error message", () => {
    expect(
      lint(
        "use-error-message",
        "const m = error instanceof Error ? error.message : String(error);",
        file,
      ),
    ).toBe(1);
    expect(
      lint("use-error-message", "const m = e instanceof Error ? e.message : `${e}`;", file),
    ).toBe(1);
  });

  it.each([
    ["the helper itself", "packages/drizzler/src/helper/error-message.ts"],
    ["a test file", "packages/drizzler/src/core/x.test.ts"],
  ])("leaves alone %s", (_, filename) => {
    expect(
      lint(
        "use-error-message",
        "const m = error instanceof Error ? error.message : String(error);",
        filename,
      ),
    ).toBe(0);
  });

  it("leaves alone another instanceof test", () => {
    expect(
      lint("use-error-message", "const n = value instanceof Date ? value.getTime() : 0;", file),
    ).toBe(0);
    expect(
      lint("use-error-message", "const s = error instanceof Error ? error.stack : null;", file),
    ).toBe(0);
  });
});
