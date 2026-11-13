import { Effect } from "effect";
import { NO_DATABASE_MESSAGE } from "../constants/index.js";
import * as ParseDomain from "../domain/parse.js";
import * as QueryDomain from "../domain/query.js";
import { DatabaseUnavailableError, QueryError, SchemaParseError } from "../errors/index.js";
import { readText } from "../services/file.js";
import * as ParseService from "../services/parse.js";
import * as QueryService from "../services/query.js";
import { getLanguage, getStudio } from "../services/studio.js";
import { schemaExports } from "../services/typescript.js";

/**
 * Runs Drizzle code against the connected database, with the saved schema.
 *
 * @param input.code - The Drizzle code, as typed on the Query page.
 * @returns The query's `result` (or the `error` it threw), the `statements` it sent and the time
 *   it took. Fails with DatabaseUnavailableError without a database, SchemaParseError when the
 *   schema does not parse, QueryError when the code does not, and FileReadError.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant U as QueryUseCase
 *   participant F as file
 *   participant P as ParseService
 *   participant D as ParseDomain
 *   participant Q as QueryService
 *   alt no database
 *     U-->>U: DatabaseUnavailableError
 *   end
 *   U->>U: language.typescript
 *   U->>F: readText({ file: schemaPath })
 *   F-->>U: schema source
 *   U->>P: findSyntaxError(schema)
 *   U->>D: makeParseError
 *   alt schema does not parse
 *     U-->>U: SchemaParseError
 *   end
 *   U->>P: parseQuery({ code })
 *   U->>D: makeQueryBody (QueryDomain)
 *   alt code does not parse
 *     U-->>U: QueryError
 *   end
 *   U->>Q: runQuery({ schemaPath, driver, typescript, module, toJson })
 *   Q-->>U: result, statements
 * ```
 */
export function runQuery(input: { readonly code: string }) {
  return Effect.gen(function* () {
    const { schemaPath, database } = getStudio();
    const driver = database.driver;
    if (driver === null) {
      return yield* new DatabaseUnavailableError({
        reason: database.status.error ?? NO_DATABASE_MESSAGE,
      });
    }
    const typescript = yield* getLanguage().typescript;
    const schemaSource = yield* readText({ file: schemaPath });
    const parseError = ParseDomain.makeParseError({
      source: schemaSource,
      error: ParseService.findSyntaxError({ source: schemaSource }),
    });
    if (parseError !== null) return yield* new SchemaParseError(parseError);
    const { body, error } = QueryDomain.makeQueryBody({
      code: input.code,
      ...ParseService.parseQuery({ code: input.code }),
    });
    if (error !== null) return yield* new QueryError(error);
    const names = schemaExports({ source: schemaSource });
    return yield* QueryService.runQuery({
      schemaPath,
      driver,
      typescript,
      module: (schemaUrl) =>
        QueryDomain.makeRuntimeModule({ dialect: driver.dialect, schemaUrl, names, body }),
      toJson: (value) => QueryDomain.makeJsonValue({ value }),
    });
  });
}

/**
 * The tables and columns Drizzle code touches, against the saved schema; none while either does not parse.
 *
 * @param input.code - The Drizzle code, as typed on the Query page.
 * @returns The touched `tables`, each with its columns and whether it is written. Fails with
 *   FileReadError when the schema cannot be read.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant U as QueryUseCase
 *   participant F as file
 *   participant P as ParseService
 *   participant D as QueryDomain
 *   U->>F: readText({ file: schemaPath })
 *   F-->>U: source
 *   U->>P: readQueryNames(code)
 *   U->>P: findSyntaxError(source)
 *   alt either does not parse
 *     U-->>U: { tables: [] }
 *   else
 *     U->>P: readSchema(source), readRelationFields(source)
 *     U->>D: makeQueryTouched
 *     D-->>U: tables
 *   end
 * ```
 */
export function touchedByQuery(input: { readonly code: string }) {
  return Effect.gen(function* () {
    const source = yield* readText({ file: getStudio().schemaPath });
    const names = ParseService.readQueryNames({ code: input.code });
    if (names === null || ParseService.findSyntaxError({ source }) !== null) return { tables: [] };
    return {
      tables: QueryDomain.makeQueryTouched({
        models: ParseService.readSchema({ source }).models,
        relationFields: ParseService.readRelationFields({ source }),
        ...names,
      }),
    };
  });
}
