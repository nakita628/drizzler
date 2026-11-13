import type { RouteHandler } from "@hono/zod-openapi";
import { Effect, Match } from "effect";
import type { getDocsRoute } from "../routes";
import { DocsSchema } from "../routes";
import * as DocsUseCase from "../usecases/docs.js";

/**
 * `GET /docs` handler. The documentation of the saved schema.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant C as Client
 *   participant H as Handler
 *   participant U as DocsUseCase
 *   C->>H: GET /docs
 *   H->>U: readDocs()
 *   U-->>H: Docs
 *   H-->>C: 200 Docs
 *   Note over H: on failure, Match.tag: FileReadError -> 500
 * ```
 */
export const getDocsRouteHandler: RouteHandler<typeof getDocsRoute> = (c) => {
  return Effect.runPromise(
    Effect.matchEffect(DocsUseCase.readDocs(), {
      onSuccess: (value) => Effect.succeed(c.json(DocsSchema.parse(value), 200)),
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
