import type { RouteHandler } from "@hono/zod-openapi";
import { Effect, Match } from "effect";
import type { postDiagramPngRoute, postDiagramSchemaRoute, postDiagramSvgRoute } from "../routes";
import { DiagramDataSchema, DiagramSchema, PngSchema } from "../routes";
import * as DiagramUseCase from "../usecases/diagram.js";

/**
 * `POST /diagram/svg` handler. A source that does not parse answers 200 with its error.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant C as Client
 *   participant H as Handler
 *   participant U as DiagramUseCase
 *   C->>H: POST /diagram/svg { source, theme }
 *   H->>U: drawSvg({ source, theme })
 *   U-->>H: Diagram
 *   H-->>C: 200 Diagram
 *   Note over U: a parse error is part of the Diagram, not a failure
 *   Note over H: on failure, Match.tag: RenderError -> 500
 * ```
 */
export const postDiagramSvgRouteHandler: RouteHandler<typeof postDiagramSvgRoute> = (c) => {
  const data = c.req.valid("json");
  return Effect.runPromise(
    Effect.matchEffect(
      DiagramUseCase.drawSvg({ source: data.source, theme: data.theme ?? "light" }),
      {
        onSuccess: (value) => Effect.succeed(c.json(DiagramSchema.parse(value), 200)),
        onFailure: (error) =>
          Match.value(error).pipe(
            Match.tag("RenderError", ({ message }) =>
              Effect.logError("cannot draw", message).pipe(
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
      },
    ),
  );
};

/**
 * `POST /diagram/png` handler. A source that does not parse is a 422 pointing at the line.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant C as Client
 *   participant H as Handler
 *   participant U as DiagramUseCase
 *   C->>H: POST /diagram/png { source, theme }
 *   H->>U: drawPng({ source, theme })
 *   U-->>H: Png
 *   H-->>C: 200 Png
 *   Note over H: on failure, Match.tag: SchemaParseError -> 422, RenderError -> 500
 * ```
 */
export const postDiagramPngRouteHandler: RouteHandler<typeof postDiagramPngRoute> = (c) => {
  const data = c.req.valid("json");
  return Effect.runPromise(
    Effect.matchEffect(
      DiagramUseCase.drawPng({ source: data.source, theme: data.theme ?? "light" }),
      {
        onSuccess: (value) => Effect.succeed(c.json(PngSchema.parse(value), 200)),
        onFailure: (error) =>
          Match.value(error).pipe(
            Match.tag("SchemaParseError", ({ message, line, column }) =>
              Effect.succeed(
                c.json(
                  {
                    type: "/problems/validation-failed",
                    title: "Validation Failed",
                    status: 422,
                    detail: "The schema does not parse.",
                    instance: c.req.path,
                    errors: [
                      { field: "source", message: `${message} (line ${line}, column ${column})` },
                    ],
                  } as const,
                  422,
                  { "Content-Type": "application/problem+json" },
                ),
              ),
            ),
            Match.tag("RenderError", ({ message }) =>
              Effect.logError("cannot draw", message).pipe(
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
      },
    ),
  );
};

/**
 * `POST /diagram/schema` handler. The diagram as data; a source that does not parse answers 200 with its error.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant C as Client
 *   participant H as Handler
 *   participant U as DiagramUseCase
 *   C->>H: POST /diagram/schema { source }
 *   H->>U: drawSchema({ source })
 *   U-->>H: DiagramData
 *   H-->>C: 200 DiagramData
 *   Note over U: a parse error is part of the DiagramData, not a failure
 *   Note over H: on failure, Match.tag: RenderError -> 500
 * ```
 */
export const postDiagramSchemaRouteHandler: RouteHandler<typeof postDiagramSchemaRoute> = (c) => {
  const data = c.req.valid("json");
  return Effect.runPromise(
    Effect.matchEffect(DiagramUseCase.drawSchema({ source: data.source }), {
      onSuccess: (value) => Effect.succeed(c.json(DiagramDataSchema.parse(value), 200)),
      onFailure: (error) =>
        Match.value(error).pipe(
          Match.tag("RenderError", ({ message }) =>
            Effect.logError("cannot draw", message).pipe(
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
