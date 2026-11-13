import type { RouteHandler } from "@hono/zod-openapi";
import { Effect, Match } from "effect";
import { streamSSE } from "hono/streaming";
import type { getSchemaEventsRoute, getSchemaRoute, putSchemaRoute } from "../routes";
import { SnapshotSchema } from "../routes";
import * as SchemaUseCase from "../usecases/schema.js";

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
 * an edit made in another editor reaches the page.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant C as Client
 *   participant H as Handler
 *   participant U as SchemaUseCase
 *   C->>H: GET /schema/events
 *   H->>U: watchSchema({ onChange })
 *   H-->>C: event: ready
 *   loop while the stream is open
 *     U-->>H: onChange()
 *     H-->>C: event: change
 *   end
 *   C-xH: abort
 *   Note over H,U: the scope closes and the watch stops
 * ```
 */
export const getSchemaEventsRouteHandler: RouteHandler<typeof getSchemaEventsRoute> = (c) => {
  return streamSSE(c, (stream) =>
    Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* SchemaUseCase.watchSchema({
            onChange() {
              void stream.writeSSE({ event: "change", data: "{}" });
            },
          });
          yield* Effect.promise(() => stream.writeSSE({ event: "ready", data: "{}" }));
          yield* Effect.promise(() => new Promise<void>((resolve) => stream.onAbort(resolve)));
        }),
      ),
    ),
  );
};
