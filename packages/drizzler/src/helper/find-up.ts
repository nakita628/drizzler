import path from "node:path";

/**
 * The nearest of \`dir\` and the directories above it that \`test\` accepts, or null when none up to
 * the root does. The test is the caller's (a file-existence check), so this only walks the path.
 *
 * @example findUp("/app/db", (d) => d === "/app") // => "/app"
 */
export function findUp(dir: string, test: (dir: string) => boolean): string | null {
  if (test(dir)) return dir;
  const parent = path.dirname(dir);
  return parent === dir ? null : findUp(parent, test);
}

/**
 * Where drizzler writes the modules it imports so the project's packages resolve as the project's:
 * \`node_modules/.cache/drizzler\` of the nearest \`node_modules\` above \`dir\`; null without one.
 */
export function nearestCacheDir(dir: string, exists: (file: string) => boolean) {
  const found = findUp(dir, (each) => exists(path.join(each, "node_modules")));
  return found === null ? null : path.join(found, "node_modules", ".cache", "drizzler");
}
