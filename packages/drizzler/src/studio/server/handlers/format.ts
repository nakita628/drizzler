import type { RouteHandler } from "@hono/zod-openapi";
import { Effect, Match } from "effect";
import type { postFormatRoute } from "../routes";
import { FormattedSchema } from "../routes";
import * as FormatUseCase from "../usecases/format.js";

/**
 * `POST /format` handler. The formatted source; a syntax error, or a config oxfmt cannot read, is a 422.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant C as Client
 *   participant H as Handler
 *   participant U as FormatUseCase
 *   C->>H: POST /format { source }
 *   H->>U: formatText({ source })
 *   U-->>H: Formatted
 *   H-->>C: 200 Formatted
 *   Note over H: on failure, Match.tag: FormatError -> 422, FileReadError -> 500
 * ```
 */
export const postFormatRouteHandler: RouteHandler<typeof postFormatRoute> = (c) => {
  const data = c.req.valid("json");
  return Effect.runPromise(
    Effect.matchEffect(FormatUseCase.formatText({ source: data.source }), {
      onSuccess: (value) => Effect.succeed(c.json(FormattedSchema.parse(value), 200)),
      onFailure: (error) =>
        Match.value(error).pipe(
          Match.tag("FormatError", ({ message }) =>
            Effect.succeed(
              c.json(
                {
                  type: "/problems/validation-failed",
                  title: "Validation Failed",
                  status: 422,
                  detail: "The formatter could not format the source.",
                  instance: c.req.path,
                  errors: [{ field: "source", message }],
                } as const,
                422,
                { "Content-Type": "application/problem+json" },
              ),
            ),
          ),
          Match.tag("FileReadError", ({ path, cause }) =>
            Effect.logError("cannot read the formatter config", path, cause).pipe(
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
