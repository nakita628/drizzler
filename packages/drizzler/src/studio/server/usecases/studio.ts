import { Effect } from "effect";
import * as QueryDomain from "../domain/query.js";
import * as SqlDomain from "../domain/sql.js";
import * as DatabaseService from "../services/database.js";
import type { Database } from "../services/database.js";
import * as StudioService from "../services/studio.js";
import * as TypeScriptService from "../services/typescript.js";

/**
 * Connects to the database at `url` when there is one. A failure is kept as the status, not
 * raised: the studio still edits the schema without a database, and says why it is not connected.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant C as Caller
 *   participant U as StudioUseCase
 *   participant D as SqlDomain
 *   participant S as DatabaseService
 *   C->>U: connectDatabase({ url, cwd })
 *   alt no url
 *     U-->>C: not connected, no error
 *   else url
 *     U->>D: makeConnection / makeDialect / makeRedactedUrl
 *     U->>S: openDriver({ connection, cwd })
 *     alt opened
 *       U-->>C: connected, with the driver
 *     else DatabaseUnavailableError
 *       U-->>C: not connected, with the reason
 *     end
 *   end
 * ```
 *
 * @param input.url - the database URL (`file:./dev.db`, `libsql://...`, `d1://...`, `postgres://...`, `mysql://...`), or null for none
 * @param input.cwd - the project directory the drivers are loaded from
 * @returns the connection (null when there is none) and the status the banner and the pages show
 */
export function connectDatabase(input: { readonly url: string | null; readonly cwd: string }) {
  const { url } = input;
  if (url === null) {
    return Effect.succeed<Database>({
      driver: null,
      status: { connected: false, dialect: null, url: null, error: null },
    });
  }
  const dialect = SqlDomain.makeDialect({ url });
  const redacted = SqlDomain.makeRedactedUrl({ url });
  return DatabaseService.openDriver({
    connection: SqlDomain.makeConnection({ url }),
    cwd: input.cwd,
  }).pipe(
    Effect.match({
      onSuccess: (driver): Database => ({
        driver,
        status: { connected: true, dialect: driver.dialect, url: redacted, error: null },
      }),
      onFailure: (error): Database => ({
        driver: null,
        status: { connected: false, dialect, url: redacted, error: error.reason },
      }),
    }),
  );
}

/**
 * Sets the studio up for the requests to come: what it works on, and the editor's TypeScript
 * over the schema, whose query preamble is written for the schema's dialect (else the database's).
 *
 * ```mermaid
 * sequenceDiagram
 *   participant C as Caller (server start)
 *   participant U as StudioUseCase
 *   participant T as TypeScriptService
 *   participant Q as QueryDomain
 *   participant S as StudioService
 *   C->>U: configureStudio({ schemaPath, cwd, database })
 *   U->>T: createLanguage({ schemaPath, queryPreamble })
 *   Note over T,Q: on each query: makeSchemaDialect, makeTypePreamble
 *   U->>S: setStudio({ studio, language })
 *   U-->>C: done
 * ```
 *
 * @param input.schemaPath - the schema file the studio edits
 * @param input.cwd - the directory relative paths start from
 * @param input.database - the connection from connectDatabase
 * @returns nothing; every later request reads the studio from StudioService
 */
export function configureStudio(input: {
  readonly schemaPath: string;
  readonly cwd: string;
  readonly database: Database;
}) {
  const fallback = input.database.status.dialect;
  const language = TypeScriptService.createLanguage({
    schemaPath: input.schemaPath,
    queryPreamble: ({ source, schemaImport, names }) =>
      QueryDomain.makeTypePreamble({
        dialect: QueryDomain.makeSchemaDialect({ source }) ?? fallback ?? "postgresql",
        schemaImport,
        names,
      }),
  });
  StudioService.setStudio({ studio: input, language });
}
