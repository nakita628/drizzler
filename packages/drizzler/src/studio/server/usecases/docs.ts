import { Effect } from "effect";
import * as DocsDomain from "../domain/docs.js";
import * as ParseDomain from "../domain/parse.js";
import { readText } from "../services/file.js";
import * as ParseService from "../services/parse.js";
import { getStudio } from "../services/studio.js";

/**
 * The docs of the saved schema; a file that does not parse has none, and says why.
 *
 * @returns The documented `tables` and `enums` with a null `parseError`, or empty lists and the
 *   `parseError` that stopped them. Fails with FileReadError when the schema cannot be read.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant U as DocsUseCase
 *   participant F as file
 *   participant P as ParseService
 *   participant D as Domain
 *   U->>F: readText({ file: schemaPath })
 *   F-->>U: source
 *   U->>P: findSyntaxError(source)
 *   U->>D: ParseDomain.makeParseError
 *   alt does not parse
 *     U-->>U: { tables: [], enums: [], parseError }
 *   else parses
 *     U->>P: readSchema(source), readRelationFields(source)
 *     U->>D: DocsDomain.makeDocs
 *     D-->>U: { tables, enums }
 *   end
 *   Note over U,F: FileReadError when the file cannot be read
 * ```
 */
export function readDocs() {
  return Effect.gen(function* () {
    const source = yield* readText({ file: getStudio().schemaPath });
    const parseError = ParseDomain.makeParseError({
      source,
      error: ParseService.findSyntaxError({ source }),
    });
    if (parseError !== null) return { tables: [], enums: [], parseError };
    const docs = DocsDomain.makeDocs({
      ...ParseService.readSchema({ source }),
      relationFields: ParseService.readRelationFields({ source }),
    });
    return { ...docs, parseError: null };
  });
}
