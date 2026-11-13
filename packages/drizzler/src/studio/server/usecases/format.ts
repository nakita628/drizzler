import { Effect } from "effect";
import * as FormatService from "../services/format.js";
import { getStudio } from "../services/studio.js";

/**
 * Formats the source as `oxfmt` would in the project: with its `.oxfmtrc.json` when it has one,
 * and oxfmt's defaults when it does not. The studio has no settings of its own for this.
 *
 * @param input.source - The schema source to format.
 * @returns The formatted `source`. Fails with FormatError when oxfmt rejects it, and with
 *   FileReadError when the config cannot be read.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant U as FormatUseCase
 *   participant S as FormatService
 *   U->>S: readSettings({ schemaPath })
 *   S-->>U: options
 *   U->>S: formatSource({ source, options })
 *   S-->>U: formatted
 *   Note over U,S: FileReadError (config), FormatError (syntax)
 * ```
 */
export function formatText(input: { readonly source: string }) {
  return Effect.gen(function* () {
    const { options } = yield* FormatService.readSettings({ schemaPath: getStudio().schemaPath });
    return { source: yield* FormatService.formatSource({ source: input.source, options }) };
  });
}
