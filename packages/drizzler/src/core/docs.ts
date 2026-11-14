import path from "node:path";
import { Effect, FileSystem } from "effect";
import { emitRaw } from "../emit/index.js";
import { fmtMarkdown } from "../format/index.js";
import { schemaSql } from "./schema-sql.js";
import {
  DOCS_FILES,
  docsDiagrams,
  docsMarkdown,
  docsSql,
  queryExamples,
  staleDiagrams,
} from "../generator/index.js";
import { diagramSchema } from "../helper/index.js";

// The diagrams of tables that are gone, so a docs directory written again holds no stale one.
function removeStaleDiagrams(input: { readonly dir: string; readonly keep: ReadonlySet<string> }) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (!(yield* fs.exists(input.dir))) return;
    const stale = staleDiagrams(yield* fs.readDirectory(input.dir), input.keep);
    yield* Effect.forEach(stale, (name) => fs.remove(path.join(input.dir, name)));
  });
}

/**
 * Writes a schema's documentation into the directory `output`: README.md, the table
 * specification as the studio's Docs page shows it, beside the ER diagram it links (er.svg), one
 * diagram per table (tables/<table>.svg: the table and the tables it joins, or the table alone).
 *
 * @param code - the schema's source lines, without their imports
 * @param output - the directory to write into, made when it is not there
 * @param theme - the colour scheme of the ER diagram, light by default
 * @param files - every file the schema is made of; given, the schema is loaded, each table's
 *   queries are shown with the SQL drizzle-orm builds for them and its definition as drizzle-kit
 *   writes it
 * @returns an Effect that writes the files: their paths, and what was left out and why
 */
export function drizzlerDocs(
  code: string[],
  output: string,
  theme?: "light" | "dark",
  files: readonly string[] = [],
) {
  return Effect.gen(function* () {
    // The SQL needs the schema loaded; without it the docs keep the queries as code.
    const loaded = docsSql(
      files.length === 0
        ? null
        : yield* schemaSql({ files, examples: queryExamples(code) }).pipe(
            Effect.match({
              onSuccess: (result) => result,
              onFailure: (error) => ({ error: error.message }),
            }),
          ),
    );
    const readme = yield* fmtMarkdown(
      docsMarkdown(code, { queries: loaded.queries, ddl: loaded.ddl }),
    );
    const diagrams = docsDiagrams(diagramSchema(code), theme);
    yield* removeStaleDiagrams({
      dir: path.join(output, DOCS_FILES.tables),
      keep: new Set(diagrams.slice(1).map(([file]) => path.basename(file))),
    });
    const outputs = [["README.md", readme] as const, ...diagrams];
    const written = yield* Effect.forEach(outputs, ([name, data]) => {
      const file = path.join(output, name);
      return emitRaw(data, file).pipe(Effect.as(file));
    });
    return { written, notes: loaded.notes };
  });
}
