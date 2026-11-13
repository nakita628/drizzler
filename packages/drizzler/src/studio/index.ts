import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import type { ServerType } from "@hono/node-server";
import { Console, Effect } from "effect";
import { STUDIO_HOSTNAME } from "./server/constants/index.js";
import app from "./server/index.js";
import { FileReadError, MissingAssetsError, ServerListenError } from "./server/errors/index.js";
import { exists } from "./server/services/file.js";
import { configureStudio, connectDatabase } from "./server/usecases/studio.js";

// The built client, beside this module's chunk in dist/.
const STATIC_DIR = fileURLToPath(new URL("./studio", import.meta.url));

/** Listens on loopback until the scope closes; a port already in use fails with ServerListenError. */
function listen(fetch: (request: Request) => Response | Promise<Response>, port: number) {
  return Effect.acquireRelease(
    Effect.callback<ServerType, ServerListenError>((resume) => {
      const server = serve({ fetch, port, hostname: STUDIO_HOSTNAME });
      server.once("listening", () => resume(Effect.succeed(server)));
      server.once("error", (error: NodeJS.ErrnoException) =>
        resume(
          Effect.fail(
            new ServerListenError({ port, code: error.code ?? null, message: error.message }),
          ),
        ),
      );
    }),
    (server) => Effect.sync(() => server.close()),
  );
}

/**
 * Serves the studio until the fiber is interrupted (Ctrl+C): the database connection and the
 * server are released then, as the scope closes.
 */
export function runStudio(options: {
  readonly file: string;
  readonly port: number;
  readonly url: string | null;
}) {
  return Effect.gen(function* () {
    const schemaPath = path.resolve(options.file);
    if (!(yield* exists({ file: schemaPath }))) {
      return yield* new FileReadError({ path: options.file, cause: "does not exist" });
    }
    if (!(yield* exists({ file: path.join(STATIC_DIR, "index.html") }))) {
      return yield* new MissingAssetsError({ dir: STATIC_DIR });
    }
    const cwd = process.cwd();
    const database = yield* connectDatabase({ url: options.url, cwd });
    yield* Effect.addFinalizer(() => database.driver?.close ?? Effect.void);
    configureStudio({ schemaPath, cwd, database });
    // The built client: no API route matches its paths, so it is served from the app's not-found
    // handler. A file is sent as it is, every other page is index.html (the client routes on the
    // path), and an unknown API path stays a 404.
    const file = serveStatic({ root: STATIC_DIR });
    const page = serveStatic({ root: STATIC_DIR, path: "index.html" });
    app.notFound(async (c) => {
      const notFound = c.text("404 Not Found", 404);
      if (c.req.path.startsWith("/api/")) return notFound;
      return (await file(c, async () => {})) ?? (await page(c, async () => {})) ?? notFound;
    });
    yield* listen(app.fetch, options.port);

    const { status } = database;
    const db = status.connected ? `\n   Database: ${status.url}` : "";
    const unconnected = status.error === null ? "" : `\n   Database not connected: ${status.error}`;
    yield* Console.log(
      `💧 drizzler studio is editing ${options.file} at http://${STUDIO_HOSTNAME}:${options.port}${db || unconnected}`,
    );
    return yield* Effect.never;
  }).pipe(Effect.scoped);
}
