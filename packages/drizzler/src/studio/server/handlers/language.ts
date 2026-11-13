import type { RouteHandler } from "@hono/zod-openapi";
import { Effect, Match } from "effect";
import type {
  getLanguageRoute,
  postLanguageCompleteDetailRoute,
  postLanguageCompleteRoute,
  postLanguageDiagnosticsRoute,
  postLanguageHoverRoute,
  postLanguageSignatureRoute,
} from "../routes";
import {
  CompletionDetailSchema,
  CompletionsSchema,
  DiagnosticsSchema,
  HoverSchema,
  LanguageStatusSchema,
  SignatureHelpSchema,
} from "../routes";
import * as LanguageUseCase from "../usecases/language.js";

/**
 * `GET /language` handler. The project's TypeScript version, or why there is none.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant C as Client
 *   participant H as Handler
 *   participant U as LanguageUseCase
 *   C->>H: GET /language
 *   H->>U: readLanguageStatus()
 *   U-->>H: LanguageStatus
 *   H-->>C: 200 LanguageStatus
 *   Note over U: never fails: a missing TypeScript is part of the status
 * ```
 */
export const getLanguageRouteHandler: RouteHandler<typeof getLanguageRoute> = (c) => {
  return Effect.runPromise(
    LanguageUseCase.readLanguageStatus().pipe(
      Effect.map((value) => c.json(LanguageStatusSchema.parse(value), 200)),
    ),
  );
};

/**
 * `POST /language/complete` handler. The completions at the cursor.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant C as Client
 *   participant H as Handler
 *   participant U as LanguageUseCase
 *   C->>H: POST /language/complete { document, source, offset }
 *   H->>U: complete({ document, source, offset })
 *   U-->>H: Completions
 *   H-->>C: 200 Completions
 *   Note over H: on failure, Match.tag: LanguageUnavailableError -> 503
 * ```
 */
export const postLanguageCompleteRouteHandler: RouteHandler<typeof postLanguageCompleteRoute> = (
  c,
) => {
  const data = c.req.valid("json");
  return Effect.runPromise(
    Effect.matchEffect(
      LanguageUseCase.complete({
        document: data.document ?? "schema",
        source: data.source,
        offset: data.offset,
      }),
      {
        onSuccess: (value) => Effect.succeed(c.json(CompletionsSchema.parse(value), 200)),
        onFailure: (error) =>
          Match.value(error).pipe(
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
            Match.exhaustive,
          ),
      },
    ),
  );
};

/**
 * `POST /language/complete/detail` handler. The type and documentation of one completion.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant C as Client
 *   participant H as Handler
 *   participant U as LanguageUseCase
 *   C->>H: POST /language/complete/detail { document, source, offset, name }
 *   H->>U: completeDetail({ document, source, offset, name })
 *   U-->>H: CompletionDetail
 *   H-->>C: 200 CompletionDetail
 *   Note over H: on failure, Match.tag: LanguageUnavailableError -> 503
 * ```
 */
export const postLanguageCompleteDetailRouteHandler: RouteHandler<
  typeof postLanguageCompleteDetailRoute
> = (c) => {
  const data = c.req.valid("json");
  return Effect.runPromise(
    Effect.matchEffect(
      LanguageUseCase.completeDetail({
        document: data.document ?? "schema",
        source: data.source,
        offset: data.offset,
        name: data.name,
      }),
      {
        onSuccess: (value) => Effect.succeed(c.json(CompletionDetailSchema.parse(value), 200)),
        onFailure: (error) =>
          Match.value(error).pipe(
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
            Match.exhaustive,
          ),
      },
    ),
  );
};

/**
 * `POST /language/hover` handler. The type of the symbol at the cursor.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant C as Client
 *   participant H as Handler
 *   participant U as LanguageUseCase
 *   C->>H: POST /language/hover { document, source, offset }
 *   H->>U: hover({ document, source, offset })
 *   U-->>H: Hover
 *   H-->>C: 200 Hover
 *   Note over H: on failure, Match.tag: LanguageUnavailableError -> 503
 * ```
 */
export const postLanguageHoverRouteHandler: RouteHandler<typeof postLanguageHoverRoute> = (c) => {
  const data = c.req.valid("json");
  return Effect.runPromise(
    Effect.matchEffect(
      LanguageUseCase.hover({
        document: data.document ?? "schema",
        source: data.source,
        offset: data.offset,
      }),
      {
        onSuccess: (value) => Effect.succeed(c.json(HoverSchema.parse(value), 200)),
        onFailure: (error) =>
          Match.value(error).pipe(
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
            Match.exhaustive,
          ),
      },
    ),
  );
};

/**
 * `POST /language/signature` handler. The signatures of the call the cursor is in.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant C as Client
 *   participant H as Handler
 *   participant U as LanguageUseCase
 *   C->>H: POST /language/signature { document, source, offset }
 *   H->>U: signature({ document, source, offset })
 *   U-->>H: SignatureHelp
 *   H-->>C: 200 SignatureHelp
 *   Note over H: on failure, Match.tag: LanguageUnavailableError -> 503
 * ```
 */
export const postLanguageSignatureRouteHandler: RouteHandler<typeof postLanguageSignatureRoute> = (
  c,
) => {
  const data = c.req.valid("json");
  return Effect.runPromise(
    Effect.matchEffect(
      LanguageUseCase.signature({
        document: data.document ?? "schema",
        source: data.source,
        offset: data.offset,
      }),
      {
        onSuccess: (value) => Effect.succeed(c.json(SignatureHelpSchema.parse(value), 200)),
        onFailure: (error) =>
          Match.value(error).pipe(
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
            Match.exhaustive,
          ),
      },
    ),
  );
};

/**
 * `POST /language/diagnostics` handler. The type errors of the source.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant C as Client
 *   participant H as Handler
 *   participant U as LanguageUseCase
 *   C->>H: POST /language/diagnostics { document, source }
 *   H->>U: diagnostics({ document, source })
 *   U-->>H: Diagnostics
 *   H-->>C: 200 Diagnostics
 *   Note over H: on failure, Match.tag: LanguageUnavailableError -> 503
 * ```
 */
export const postLanguageDiagnosticsRouteHandler: RouteHandler<
  typeof postLanguageDiagnosticsRoute
> = (c) => {
  const data = c.req.valid("json");
  return Effect.runPromise(
    Effect.matchEffect(
      LanguageUseCase.diagnostics({ document: data.document ?? "schema", source: data.source }),
      {
        onSuccess: (value) => Effect.succeed(c.json(DiagnosticsSchema.parse(value), 200)),
        onFailure: (error) =>
          Match.value(error).pipe(
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
            Match.exhaustive,
          ),
      },
    ),
  );
};
