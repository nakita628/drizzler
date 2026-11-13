import fs from "node:fs";
import type { RouteHandler } from "@hono/zod-openapi";
import { Effect, Match } from "effect";
import { streamSSE } from "hono/streaming";
import type { getSchemaEventsRoute, getSchemaRoute, putSchemaRoute } from "../routes";
import { SnapshotSchema } from "../routes";
import { WATCH_INTERVAL_MS } from "../constants/index.js";
import * as SchemaUseCase from "../usecases/schema.js";
import * as StudioUseCase from "../usecases/studio.js";

/**
 * `GET /schema` handler. The schema file as it is on disk.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant C as Client
 *   participant H as Handler
 *   participant U as SchemaUseCase
 *   C->>H: GET /schema
 *   H->>U: readSchema()
 *   U-->>H: Snapshot
 *   H-->>C: 200 Snapshot
 *   Note over H: on failure, Match.tag: FileReadError -> 500
 * ```
 */
export const getSchemaRouteHandler: RouteHandler<typeof getSchemaRoute> = (c) => {
  return Effect.runPromise(
    Effect.matchEffect(SchemaUseCase.readSchema(), {
      onSuccess: (value) => Effect.succeed(c.json(SnapshotSchema.parse(value), 200)),
      onFailure: (error) =>
        Match.value(error).pipe(
          Match.tag("FileReadError", ({ path, cause }) =>
            Effect.logError("cannot read the schema", path, cause).pipe(
              Effect.as(
                c.json(
                  {
                    type: "/problems/internal-server-error",
                    title: "Internal Server Error",
                    status: 500,
                    detail: "An unexpected error occurred.",
                    instance: c.req.path,
                  } as const,
                  500,
                  { "Content-Type": "application/problem+json" },
                ),
              ),
            ),
          ),
          Match.exhaustive,
        ),
    }),
  );
};

/**
 * `PUT /schema` handler. Writes the schema file.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant C as Client
 *   participant H as Handler
 *   participant U as SchemaUseCase
 *   C->>H: PUT /schema { source }
 *   H->>U: writeSchema({ source })
 *   U-->>H: Snapshot
 *   H-->>C: 200 Snapshot
 *   Note over H: on failure, Match.tag: FileWriteError -> 500
 * ```
 */
export const putSchemaRouteHandler: RouteHandler<typeof putSchemaRoute> = (c) => {
  const data = c.req.valid("json");
  return Effect.runPromise(
    Effect.matchEffect(SchemaUseCase.writeSchema({ source: data.source }), {
      onSuccess: (value) => Effect.succeed(c.json(SnapshotSchema.parse(value), 200)),
      onFailure: (error) =>
        Match.value(error).pipe(
          Match.tag("FileWriteError", ({ path, cause }) =>
            Effect.logError("cannot write the schema", path, cause).pipe(
              Effect.as(
                c.json(
                  {
                    type: "/problems/internal-server-error",
                    title: "Internal Server Error",
                    status: 500,
                    detail: "An unexpected error occurred.",
                    instance: c.req.path,
                  } as const,
                  500,
                  { "Content-Type": "application/problem+json" },
                ),
              ),
            ),
          ),
          Match.exhaustive,
        ),
    }),
  );
};

/**
 * `GET /schema/events` handler. A `change` event whenever the schema file changes on disk, so
 * an edit made in another editor reaches the page. The file is polled: `fs.watch` misses writes
 * through bind mounts and editors that replace the file.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant C as Client
 *   participant H as Handler
 *   participant U as StudioUseCase
 *   participant F as fs.watchFile
 *   C->>H: GET /schema/events
 *   H->>U: readSchemaPath()
 *   U-->>H: schemaPath
 *   H->>F: watchFile(schemaPath, WATCH_INTERVAL_MS)
 *   H-->>C: event: ready
 *   loop while the stream is open
 *     F-->>H: stats (mtime changed)
 *     H-->>C: event: change
 *   end
 *   C-xH: abort
 *   H->>F: unwatchFile(schemaPath)
 * ```
 */
export const getSchemaEventsRouteHandler: RouteHandler<typeof getSchemaEventsRoute> = (c) => {
  return streamSSE(c, async (stream) => {
    const file = StudioUseCase.readSchemaPath();
    function listener(current: fs.Stats, previous: fs.Stats) {
      if (current.mtimeMs !== previous.mtimeMs) {
        void stream.writeSSE({ event: "change", data: "{}" });
      }
    }
    fs.watchFile(file, { interval: WATCH_INTERVAL_MS }, listener);
    await stream.writeSSE({ event: "ready", data: "{}" });
    await new Promise<void>((resolve) => stream.onAbort(resolve));
    fs.unwatchFile(file, listener);
  });
};
