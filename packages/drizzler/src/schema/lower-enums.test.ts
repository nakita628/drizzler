import module from "node:module";
import { describe, expect, it } from "vite-plus/test";
import { lowerEnums } from "./lower-enums.js";

// The module the lowered source makes once its types are stripped, as the docs loader runs it.
async function run(source: string) {
  const js = module.stripTypeScriptTypes(lowerEnums(source));
  const loaded: unknown = await import(`data:text/javascript,${encodeURIComponent(js)}`);
  return loaded;
}

describe("lowerEnums", () => {
  it("leaves a source without an enum as it is", () => {
    const source = 'export const enumName = "x";\nexport const a = 1;';
    expect(lowerEnums(source)).toBe(source);
  });

  it("makes a string enum the object TypeScript emits, keeping every line below in place", async () => {
    const source = [
      "export enum ActivityType {",
      '  SIGN_UP = "SIGN_UP",',
      '  SIGN_IN = "SIGN_IN",',
      "}",
      "export const after = 1;",
    ].join("\n");
    const lowered = lowerEnums(source);
    expect(lowered.split("\n")).toHaveLength(5);
    expect(lowered.split("\n")[4]).toBe("export const after = 1;");
    expect(await run(source)).toMatchObject({
      ActivityType: { SIGN_UP: "SIGN_UP", SIGN_IN: "SIGN_IN" },
      after: 1,
    });
  });

  it("numbers members as TypeScript does, with reverse entries, and reads earlier members bare", async () => {
    const source = [
      'export const enum Flags { None, A = 1 << 0, B = A << 1, C, "x-y" = 10, Z }',
      "enum Keyword { default = 3, Next }",
      "function inner() { enum Local { K = 7 } return Local.K; }",
      "export const out = { Keyword, local: inner() };",
    ].join("\n");
    const loaded = await run(source);
    expect(loaded).toMatchObject({
      Flags: { None: 0, A: 1, B: 2, C: 3, "x-y": 10, Z: 11, 0: "None", 11: "Z" },
      out: { Keyword: { default: 3, Next: 4, 3: "default" }, local: 7 },
    });
  });

  it("leaves a `declare enum`, which strip mode erases", () => {
    const source = "export declare enum D { Q }";
    expect(lowerEnums(source)).toBe(source);
  });
});
