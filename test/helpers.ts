import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import readline from "node:readline";

const require = createRequire(import.meta.url);
const PACKAGE_DIR = path.dirname(require.resolve("drizzler/package.json"));

/** The packaged command, as `npx drizzler` runs it. */
export const BIN = path.join(PACKAGE_DIR, "dist/cli.js");

/** Where each test's project lives: under test/, so `drizzler` and `drizzle-orm` resolve. */
const TMP = path.join(import.meta.dirname, ".tmp");

/** The repository's examples, read in place. */
export const EXAMPLES = path.resolve(import.meta.dirname, "../examples");

/**
 * The version the package declares.
 *
 * @returns the `version` of drizzler's package.json
 */
export function packageVersion() {
  const parsed: unknown = JSON.parse(
    fs.readFileSync(path.join(PACKAGE_DIR, "package.json"), "utf8"),
  );
  return typeof parsed === "object" && parsed !== null && "version" in parsed
    ? String(parsed.version)
    : "";
}

/**
 * A fresh project directory with the given files.
 *
 * @param files - each file's path in the project and its text
 * @returns the directory's absolute path
 */
export function makeProject(files: Readonly<Record<string, string>>) {
  fs.mkdirSync(TMP, { recursive: true });
  const dir = fs.mkdtempSync(path.join(TMP, "project-"));
  for (const [file, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
  }
  return dir;
}

/**
 * Removes a project made by `makeProject`.
 *
 * @param dir - the project directory
 */
export function removeProject(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// The exit code of a finished child: 0 without an error, else the code it exited with.
function exitCode(error: { readonly code?: unknown } | null) {
  if (error === null) return 0;
  return typeof error.code === "number" ? error.code : 1;
}

/**
 * Runs the packaged command to its end.
 *
 * @param args - the command line after `drizzler`
 * @param cwd - the directory it runs in
 * @returns its exit code and what it printed (stdout and stderr together, as a terminal shows them)
 */
export function drizzler(args: readonly string[], cwd: string) {
  return new Promise<{ readonly code: number; readonly output: string }>((resolve) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { cwd, env: { ...process.env, NO_COLOR: "1", DATABASE_URL: "" } },
      (error, stdout, stderr) => {
        resolve({ code: exitCode(error), output: `${stdout}${stderr}`.trim() });
      },
    );
  });
}

/**
 * A port nothing listens on, from the operating system.
 *
 * @returns a free TCP port on 127.0.0.1
 */
export function freePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Starts `drizzler studio` and waits for its banner.
 *
 * @param args - the command line after `drizzler`
 * @param cwd - the directory it runs in
 * @returns the banner's lines and a function that stops the server
 */
export function startStudio(args: readonly string[], cwd: string) {
  const child = spawn(process.execPath, [BIN, ...args], {
    cwd,
    env: { ...process.env, NO_COLOR: "1", DATABASE_URL: "" },
  });
  const lines = readline.createInterface({ input: child.stdout });
  const banner = new Promise<string>((resolve, reject) => {
    lines.on("line", (line) => {
      if (line.includes("drizzler studio is editing")) resolve(line);
    });
    child.once("exit", (code) => reject(new Error(`drizzler studio exited with ${code}`)));
  });
  function stop() {
    return new Promise<void>((resolve) => {
      if (child.exitCode !== null) return resolve();
      child.once("exit", () => resolve());
      child.kill("SIGINT");
    });
  }
  return { banner, stop };
}

/**
 * Sends a request with a given Host header, which `fetch` does not let a caller set.
 *
 * @param url - the address to request
 * @param host - the Host header to send
 * @returns the status code and the body
 */
export function requestWithHost(url: string, host: string) {
  return new Promise<{ readonly status: number; readonly body: string }>((resolve, reject) => {
    const request = http.get(url, { headers: { host } }, (response) => {
      response.setEncoding("utf8");
      const body = response.toArray().then((chunks) => chunks.join(""));
      void body.then((text) => resolve({ status: response.statusCode ?? 0, body: text }));
    });
    request.once("error", reject);
  });
}
