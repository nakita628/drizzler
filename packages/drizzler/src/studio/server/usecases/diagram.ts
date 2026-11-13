import { Effect } from "effect";
import { erPng, erSvg } from "../../../generator/index.js";
import { stripImports } from "../../../schema/strip-imports.js";
import * as CanvasDomain from "../domain/canvas.js";
import * as ParseDomain from "../domain/parse.js";
import { RenderError, SchemaParseError } from "../errors/index.js";
import * as ParseService from "../services/parse.js";

type Theme = "light" | "dark";

function render<A>(draw: () => A) {
  return Effect.try({
    try: draw,
    catch: (error) =>
      new RenderError({ message: error instanceof Error ? error.message : String(error) }),
  });
}

/**
 * The ER diagram as SVG, or the syntax error that stopped it (the page keeps the last drawing).
 *
 * @param input.source - The schema source as the editor holds it.
 * @param input.theme - The colour scheme to draw in.
 * @returns The `svg` with a null `parseError`, or a null `svg` and the `parseError`. Fails with
 *   RenderError when drawing throws.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant U as DiagramUseCase
 *   participant P as ParseService
 *   participant D as ParseDomain
 *   participant G as generator
 *   U->>P: findSyntaxError(source)
 *   U->>D: makeParseError
 *   alt does not parse
 *     U-->>U: { svg: null, parseError }
 *   else
 *     U->>G: erSvg(stripImports(source), theme)
 *     G-->>U: svg
 *   end
 *   Note over U,G: RenderError when drawing throws
 * ```
 */
export function drawSvg(input: { readonly source: string; readonly theme: Theme }) {
  return Effect.gen(function* () {
    const parseError = ParseDomain.makeParseError({
      source: input.source,
      error: ParseService.findSyntaxError({ source: input.source }),
    });
    if (parseError !== null) return { svg: null, parseError };
    const svg = yield* render(() => erSvg(stripImports(input.source), input.theme));
    return { svg, parseError: null };
  });
}

/**
 * The ER diagram as a base64 PNG; a source that does not parse fails.
 *
 * @param input.source - The schema source as the editor holds it.
 * @param input.theme - The colour scheme to draw in.
 * @returns The PNG as `base64`. Fails with SchemaParseError when the source does not parse, and
 *   with RenderError when drawing throws.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant U as DiagramUseCase
 *   participant P as ParseService
 *   participant D as ParseDomain
 *   participant G as generator
 *   U->>P: findSyntaxError(source)
 *   U->>D: makeParseError
 *   alt does not parse
 *     U-->>U: SchemaParseError
 *   end
 *   U->>G: erPng(stripImports(source), theme)
 *   G-->>U: png bytes
 *   Note over U,G: RenderError when drawing throws
 * ```
 */
export function drawPng(input: { readonly source: string; readonly theme: Theme }) {
  return Effect.gen(function* () {
    const parseError = ParseDomain.makeParseError({
      source: input.source,
      error: ParseService.findSyntaxError({ source: input.source }),
    });
    if (parseError !== null) return yield* new SchemaParseError(parseError);
    const png = yield* render(() => erPng(stripImports(input.source), input.theme));
    return { base64: Buffer.from(png).toString("base64") };
  });
}

/**
 * The ER diagram as data for the canvas, or the syntax error that stopped it (the page keeps the last one).
 *
 * @param input.source - The schema source as the editor holds it.
 * @returns The canvas `schema` with a null `parseError`, or a null `schema` and the `parseError`.
 *   Fails with RenderError when reading the schema throws.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant U as DiagramUseCase
 *   participant P as ParseService
 *   participant D as Domain
 *   U->>P: findSyntaxError(source)
 *   U->>D: ParseDomain.makeParseError
 *   alt does not parse
 *     U-->>U: { schema: null, parseError }
 *   else
 *     U->>P: readSchema(source), findTableSpans(source)
 *     U->>D: CanvasDomain.makeCanvasSchema
 *     D-->>U: schema
 *   end
 * ```
 */
export function drawSchema(input: { readonly source: string }) {
  return Effect.gen(function* () {
    const parseError = ParseDomain.makeParseError({
      source: input.source,
      error: ParseService.findSyntaxError({ source: input.source }),
    });
    if (parseError !== null) return { schema: null, parseError };
    const schema = yield* render(() =>
      CanvasDomain.makeCanvasSchema({
        source: input.source,
        ...ParseService.readSchema({ source: input.source }),
        spans: ParseService.findTableSpans({ source: input.source }),
      }),
    );
    return { schema, parseError: null };
  });
}
