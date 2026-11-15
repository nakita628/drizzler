import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Effect } from "effect";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { watchFile } from "./file.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drizzler-watch-"));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Keeps the libuv thread pool (4 threads) busy for a while, as a full test run does. */
function busyThreadPool() {
  for (const i of Array.from({ length: 8 }, (_, n) => n)) {
    crypto.pbkdf2(String(i), "salt", 200_000, 64, "sha512", () => {});
  }
}

/** Watches `file`, runs `change` as soon as the watch is set up, and waits for the first change. */
function firstChange(file: string, change: () => void) {
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const seen = Promise.withResolvers<"seen">();
        yield* watchFile({ file, intervalMs: 20, onChange: () => seen.resolve("seen") });
        change();
        return yield* Effect.promise(() =>
          Promise.race([
            seen.promise,
            new Promise<"missed">((resolve) => setTimeout(() => resolve("missed"), 3000)),
          ]),
        );
      }),
    ),
  );
}

describe("watchFile", () => {
  it("sees a change made as soon as it returns, even while the thread pool is busy", async () => {
    const file = path.join(dir, "busy.ts");
    fs.writeFileSync(file, "a");
    const earlier = new Date(Date.now() - 60_000);
    fs.utimesSync(file, earlier, earlier);
    busyThreadPool();
    expect(
      await firstChange(file, () => {
        fs.writeFileSync(file, "b");
        fs.utimesSync(file, new Date(), new Date());
      }),
    ).toBe("seen");
  });

  it("sees a file that an editor replaced, and one that comes back after it was missing", async () => {
    const file = path.join(dir, "replaced.ts");
    expect(await firstChange(file, () => fs.writeFileSync(file, "created"))).toBe("seen");
    const temp = path.join(dir, "replaced.tmp");
    fs.writeFileSync(temp, "saved");
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(temp, later, later);
    expect(await firstChange(file, () => fs.renameSync(temp, file))).toBe("seen");
  });

  it("calls nothing while the file stays the same", async () => {
    const file = path.join(dir, "still.ts");
    fs.writeFileSync(file, "a");
    expect(await firstChange(file, () => undefined)).toBe("missed");
  });
});
