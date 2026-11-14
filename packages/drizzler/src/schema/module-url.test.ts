import { describe, expect, it } from "vite-plus/test";
import { isProjectFile, isProjectTypeScript } from "./module-url.js";

describe("module URLs", () => {
  it.each([
    ["file:///app/db/schema.ts", true, true],
    ["file:///app/db/schema.mts", true, true],
    ["file:///app/db/schema.js", true, false],
    ["file:///app/node_modules/drizzle-orm/index.ts", false, false],
    ["node:fs", false, false],
  ])("%s: project file %s, project TypeScript %s", (url, file, typescript) => {
    expect(isProjectFile(url)).toBe(file);
    expect(isProjectTypeScript(url)).toBe(typescript);
  });
});
