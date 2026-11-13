import type { RouteHandler } from "@hono/zod-openapi";
import { Effect, Match } from "effect";
import type { postDrizzleRoute, postDrizzleTouchedRoute } from "../routes";
import { QueryResultSchema, QueryTouchedSchema } from "../routes";
import * as QueryUseCase from "../usecases/query.js";

/**
 * `POST /drizzle` handler. Runs Drizzle code; what it throws comes back in the result, while
 * code or a schema that does not parse is a 422 and a missing database or TypeScript a 503.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant C as Client
 *   participant H as Handler
 *   participant U as QueryUseCase
 *   C->>H: POST /drizzle { code }
 *   H->>U: runQuery({ code })
 *   U-->>H: QueryResult
 *   H-->>C: 200 QueryResult
 *   Note over U: what the code throws is part of the QueryResult, not a failure
 *   Note over H: on failure, Match.tag: QueryError -> 422, SchemaParseError -> 422, DatabaseUnavailableError -> 503, LanguageUnavailableError -> 503, FileReadError -> 500
 * ```
 */
export const postDrizzleRouteHandler: RouteHandler<typeof postDrizzleRoute> = (c) => {
  const data = c.req.valid("json");
  return Effect.runPromise(
    Effect.matchEffect(QueryUseCase.runQuery({ code: data.code }), {
      onSuccess: (value) => Effect.succeed(c.json(QueryResultSchema.parse(value), 200)),
      onFailure: (error) =>
        Match.value(error).pipe(
          Match.tag("QueryError", ({ message, line, column }) =>
            Effect.succeed(
              c.json(
                {
                  type: "/problems/validation-failed",
                  title: "Validation Failed",
                  status: 422,
                  detail: "The query does not parse.",
                  instance: c.req.path,
                  errors: [
                    { field: "code", message: `${message} (line ${line}, column ${column})` },
                  ],
                } as const,
                422,
                { "Content-Type": "application/problem+json" },
              ),
            ),
          ),
          Match.tag("SchemaParseError", ({ message, line }) =>
            Effect.succeed(
              c.json(
                {
                  type: "/problems/validation-failed",
                  title: "Validation Failed",
                  status: 422,
                  detail: "The saved schema does not parse.",
                  instance: c.req.path,
                  errors: [{ field: "schema", message: `${message} (line ${line})` }],
                } as const,
                422,
                { "Content-Type": "application/problem+json" },
              ),
            ),
          ),
          Match.tag("DatabaseUnavailableError", ({ reason }) =>
            Effect.succeed(
              c.json(
                {
                  type: "/problems/service-unavailable",
                  title: "Service Unavailable",
                  status: 503,
                  detail: reason,
                  instance: c.req.path,
                } as const,
                503,
                { "Content-Type": "application/problem+json" },
              ),
            ),
          ),
          Match.tag("LanguageUnavailableError", ({ reason }) =>
            Effect.succeed(
              c.json(
                {
                  type: "/problems/service-unavailable",
                  title: "Service Unavailable",
                  status: 503,
                  detail: reason,
                  instance: c.req.path,
                } as const,
                503,
                { "Content-Type": "application/problem+json" },
              ),
            ),
          ),
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
 * `POST /drizzle/touched` handler. The tables and columns Drizzle code touches; code that does
 * not parse touches none.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant C as Client
 *   participant H as Handler
 *   participant U as QueryUseCase
 *   C->>H: POST /drizzle/touched { code }
 *   H->>U: touchedByQuery({ code })
 *   U-->>H: QueryTouched
 *   H-->>C: 200 QueryTouched
 *   Note over H: on failure, Match.tag: FileReadError -> 500
 * ```
 */
export const postDrizzleTouchedRouteHandler: RouteHandler<typeof postDrizzleTouchedRoute> = (c) => {
  const data = c.req.valid("json");
  return Effect.runPromise(
    Effect.matchEffect(QueryUseCase.touchedByQuery({ code: data.code }), {
      onSuccess: (value) => Effect.succeed(c.json(QueryTouchedSchema.parse(value), 200)),
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
