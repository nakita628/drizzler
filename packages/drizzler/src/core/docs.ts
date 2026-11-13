import path from "node:path";
import { Effect, FileSystem } from "effect";
import { emitRaw } from "../emit/index.js";
import { fmtMarkdown } from "../format/index.js";
import { schemaSql } from "./schema-sql.js";
import {
  DOCS_FILES,
  docsMarkdown,
  neighborhood,
  queryExamples,
  schemaSvg,
  tableDiagramPath,
} from "../generator/index.js";
import { diagramSchema } from "../helper/index.js";

// The diagrams of tables that are gone, so a docs directory written again holds no stale one.
function removeStaleDiagrams(input: { readonly dir: string; readonly keep: ReadonlySet<string> }) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (!(yield* fs.exists(input.dir))) return;
    const stale = (yield* fs.readDirectory(input.dir)).filter(
      (name) => name.endsWith(".svg") && !input.keep.has(name),
    );
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
    const loaded =
      files.length === 0
        ? { queries: null, ddl: null, notes: ["the schema's files were not given"] }
        : yield* schemaSql({ files, examples: queryExamples(code) }).pipe(
            Effect.match({
              onSuccess: ({ queries, ddl }) => ({
                queries,
                ddl: ddl.error === null ? ddl.statements : null,
                notes:
                  ddl.error === null
                    ? []
                    : [`The tables are shown without their SQL definitions: ${ddl.error}`],
              }),
              onFailure: (error) => ({
                queries: null,
                ddl: null,
                notes: [`The queries and tables are shown without their SQL: ${error.message}`],
              }),
            }),
          );
    const readme = yield* fmtMarkdown(
      docsMarkdown(code, { queries: loaded.queries, ddl: loaded.ddl }),
    );
    const schema = diagramSchema(code);
    const outputs = [
      ["README.md", readme],
      [DOCS_FILES.diagram, schemaSvg(schema, theme)],
    ] as const;
    // Each table gets its own diagram: it and the tables it joins, or it alone.
    const tables = schema.models.map(
      (m) => [tableDiagramPath(m.name), schemaSvg(neighborhood(schema, m.name), theme)] as const,
    );
    yield* removeStaleDiagrams({
      dir: path.join(output, DOCS_FILES.tables),
      keep: new Set(tables.map(([file]) => path.basename(file))),
    });
    const written = yield* Effect.forEach([...outputs, ...tables], ([name, data]) => {
      const file = path.join(output, name);
      return emitRaw(data, file).pipe(Effect.as(file));
    });
    return { written, notes: loaded.notes };
  });
}
