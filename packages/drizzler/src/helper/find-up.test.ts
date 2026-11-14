import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { findUp, nearestCacheDir } from "./find-up.js";

const root = path.parse(process.cwd()).root;
const app = path.join(root, "app");
const db = path.join(app, "src", "db");

describe("findUp", () => {
  it("finds the nearest directory the test accepts, the start included", () => {
    expect(findUp(db, (dir) => dir === app)).toBe(app);
    expect(findUp(db, (dir) => dir === db)).toBe(db);
  });

  it("is null when none up to the root is accepted", () => {
    const seen: string[] = [];
    expect(
      findUp(db, (dir) => {
        seen.push(dir);
        return false;
      }),
    ).toBeNull();
    expect(seen).toStrictEqual([db, path.join(app, "src"), app, root]);
  });
});

describe("nearestCacheDir", () => {
  it("is the cache directory of the nearest node_modules", () => {
    function exists(file: string) {
      return file === path.join(app, "node_modules");
    }
    expect(nearestCacheDir(db, exists)).toBe(path.join(app, "node_modules", ".cache", "drizzler"));
    expect(nearestCacheDir(db, () => false)).toBeNull();
  });
});
