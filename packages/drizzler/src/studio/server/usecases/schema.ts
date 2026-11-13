import path from "node:path";
import { Effect } from "effect";
import * as ParseDomain from "../domain/parse.js";
import * as ParseService from "../services/parse.js";
import { readText, writeText } from "../services/file.js";
import { getStudio } from "../services/studio.js";

function snapshot(schemaPath: string, source: string) {
  return {
    path: schemaPath,
    file: path.basename(schemaPath),
    source,
    parseError: ParseDomain.makeParseError({
      source,
      error: ParseService.findSyntaxError({ source }),
    }),
  };
}

/**
 * The schema file as it is on disk.
 *
 * @returns Its `path`, `file` name, `source` and the `parseError` found in it (null when it parses).
 *   Fails with FileReadError when it cannot be read.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant U as SchemaUseCase
 *   participant F as file
 *   participant P as ParseService
 *   participant D as ParseDomain
 *   U->>F: readText({ file: schemaPath })
 *   F-->>U: source
 *   U->>P: findSyntaxError(source)
 *   U->>D: makeParseError
 *   D-->>U: parseError | null
 *   Note over U,F: FileReadError
 * ```
 */
export function readSchema() {
  return Effect.gen(function* () {
    const { schemaPath } = getStudio();
    return snapshot(schemaPath, yield* readText({ file: schemaPath }));
  });
}

/**
 * Writes the schema file; a source that does not parse is still saved, and its error reported.
 *
 * @param input.source - The new schema source.
 * @returns The saved `path`, `file` name, `source` and its `parseError`. Fails with FileWriteError
 *   when it cannot be written.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant U as SchemaUseCase
 *   participant F as file
 *   participant P as ParseService
 *   participant D as ParseDomain
 *   U->>F: writeText({ file: schemaPath, text: source })
 *   U->>P: findSyntaxError(source)
 *   U->>D: makeParseError
 *   D-->>U: parseError | null
 *   Note over U,F: FileWriteError
 * ```
 */
export function writeSchema(input: { readonly source: string }) {
  return Effect.gen(function* () {
    const { schemaPath } = getStudio();
    yield* writeText({ file: schemaPath, text: input.source });
    return snapshot(schemaPath, input.source);
  });
}
