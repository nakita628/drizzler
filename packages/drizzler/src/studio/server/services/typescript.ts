import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Effect, Semaphore } from "effect";
import type ts from "typescript";
import { declaratorName, exportedDeclarations, parseSource } from "../../../helper/ast.js";
import { LanguageUnavailableError } from "../errors/index.js";

type TypeScript = typeof ts;

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isTypeScript(value: unknown): value is TypeScript {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "createLanguageService") === "function" &&
    typeof Reflect.get(value, "version") === "string"
  );
}

/**
 * The `typescript` directory in the nearest `node_modules` above the schema. Looked up by hand
 * rather than by `require.resolve("typescript")`, which also searches NODE_PATH: pnpm points that
 * at its whole store when it runs a bin, and a TypeScript the project does not have would answer.
 */
function projectTypeScript(schemaPath: string) {
  return typeScriptFrom(path.dirname(path.resolve(schemaPath)));
}

function typeScriptFrom(dir: string): string | null {
  const candidate = path.join(dir, "node_modules", "typescript");
  if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
  const parent = path.dirname(dir);
  return parent === dir ? null : typeScriptFrom(parent);
}

/**
 * The project's own `typescript`, resolved from the schema's directory as the project resolves
 * it: the studio ships none, and the schema is checked the way the project checks it.
 */
function loadTypeScript(schemaPath: string) {
  return Effect.gen(function* () {
    const directory = projectTypeScript(schemaPath);
    if (directory === null) {
      return yield* new LanguageUnavailableError({
        reason: `Cannot load "typescript" next to ${schemaPath}: no node_modules/typescript above the schema. Install it (npm install -D typescript) for completion in the editor.`,
      });
    }
    const loaded = yield* Effect.tryPromise({
      async try(): Promise<unknown> {
        const resolved = createRequire(schemaPath).resolve(directory);
        const namespace: unknown = await import(pathToFileURL(resolved).href);
        return typeof namespace === "object" && namespace !== null && "default" in namespace
          ? namespace.default
          : namespace;
      },
      catch: (error) =>
        new LanguageUnavailableError({
          reason: `Cannot load "typescript" next to ${schemaPath}: ${message(error)}. Install it (npm install -D typescript) for completion in the editor.`,
        }),
    });
    if (!isTypeScript(loaded)) {
      return yield* new LanguageUnavailableError({
        reason:
          "Completion needs a TypeScript with the language service API (5.x or 6.x); TypeScript 7 does not have one yet.",
      });
    }
    return loaded;
  });
}

/** The project's compiler options from the nearest tsconfig.json, or ones that suit a schema file. */
function compilerOptions(typescript: TypeScript, schemaPath: string): ts.CompilerOptions {
  const defaults: ts.CompilerOptions = {
    target: typescript.ScriptTarget.ESNext,
    module: typescript.ModuleKind.ESNext,
    moduleResolution: typescript.ModuleResolutionKind.Bundler,
    strict: true,
    skipLibCheck: true,
    allowImportingTsExtensions: true,
  };
  const config = typescript.findConfigFile(path.dirname(schemaPath), (file) =>
    typescript.sys.fileExists(file),
  );
  // The query file imports the schema by its `.ts` name; nothing is emitted, so that is allowed.
  if (config === undefined) return { ...defaults, noEmit: true };
  const parsed = typescript.getParsedCommandLineOfConfigFile(
    config,
    {},
    {
      ...typescript.sys,
      onUnRecoverableConfigFileDiagnostic: () => undefined,
    },
  );
  return { ...(parsed?.options ?? defaults), noEmit: true, allowImportingTsExtensions: true };
}

/** The file a query is checked as: beside the schema, so it imports it and drizzle-orm as the schema does. */
const QUERY_FILE = "__drizzler_query__.ts";

/**
 * A language service over the schema file and a query file beside it. The schema editor's text
 * stands in for the schema on disk (`schema.text`; null reads the file), and the query file is
 * the query with the lines that give it `db` and the tables in front (`query.text`). Every other
 * file, drizzle-orm's types included, is read from disk as the project has it.
 */
function makeLanguageHost(typescript: TypeScript, schemaPath: string) {
  const file = path.resolve(schemaPath);
  const queryFile = path.join(path.dirname(file), QUERY_FILE);
  // The texts the service reads in place of the files, each replaced as a whole when it changes.
  const documents: Documents = new Map([
    ["schema", { text: null, version: 0 }],
    ["query", { text: "", version: 0 }],
  ]);
  const options = compilerOptions(typescript, file);
  function modified(name: string) {
    return String(typescript.sys.getModifiedTime?.(name)?.getTime() ?? 0);
  }
  function scriptVersion(name: string) {
    const schema = documentOf(documents, "schema");
    if (name === file) return `${schema.version}:${schema.text === null ? modified(name) : ""}`;
    if (name === queryFile) return String(documentOf(documents, "query").version);
    return modified(name);
  }
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [file, queryFile],
    getScriptVersion: scriptVersion,
    getScriptSnapshot(name) {
      const schemaText = documentOf(documents, "schema").text;
      if (name === file && schemaText !== null)
        return typescript.ScriptSnapshot.fromString(schemaText);
      if (name === queryFile) {
        return typescript.ScriptSnapshot.fromString(documentOf(documents, "query").text ?? "");
      }
      const text = typescript.sys.readFile(name);
      return text === undefined ? undefined : typescript.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => path.dirname(file),
    getCompilationSettings: () => options,
    getDefaultLibFileName: (settings) => typescript.getDefaultLibFilePath(settings),
    fileExists: (name) => name === queryFile || typescript.sys.fileExists(name),
    readFile: (name, encoding) => typescript.sys.readFile(name, encoding),
    readDirectory: (dir, extensions, exclude, include, depth) =>
      typescript.sys.readDirectory(dir, extensions, exclude, include, depth),
    directoryExists: (dir) => typescript.sys.directoryExists(dir),
    getDirectories: (dir) => typescript.sys.getDirectories(dir),
    realpath: (name) => typescript.sys.realpath?.(name) ?? name,
  };
  const service = typescript.createLanguageService(host, typescript.createDocumentRegistry());
  return { ts: typescript, service, file, queryFile, documents };
}

/** A text the language service reads in place of a file; null reads the file from disk. */
type Document = { readonly text: string | null; readonly version: number };
type Documents = Map<DocumentKind, Document>;

function documentOf(documents: Documents, kind: DocumentKind): Document {
  return documents.get(kind) ?? { text: null, version: 0 };
}

/** Puts a new text in place, moving its version on so the service reads it again. */
function replaceDocument(documents: Documents, kind: DocumentKind, text: string | null) {
  const current = documentOf(documents, kind);
  if (current.text !== text) documents.set(kind, { text, version: current.version + 1 });
}

type Loaded = ReturnType<typeof makeLanguageHost>;

/** Which text a request is about: the schema in its editor, or a query on the Query page. */
export type DocumentKind = "schema" | "query";

/**
 * Reads the names a schema module exports, in file order: `export const` declarations and the
 * names of an `export { ... }` list. A query sees these as its scope.
 *
 * ```mermaid
 * flowchart LR
 *   src[input.source] --> oxc[parse with oxc]
 *   oxc --> declared[export const names]
 *   oxc --> listed[export list names]
 *   declared --> names[unique names, in order]
 *   listed --> names
 * ```
 *
 * @param input.source - the schema's TypeScript source
 * @returns the exported value names, each once
 */
export function schemaExports(input: { readonly source: string }) {
  const { program } = parseSource(input.source.split("\n"));
  const declared = exportedDeclarations(program)
    .map(({ declarator }) => declaratorName(declarator))
    .filter((name): name is string => name !== null);
  // `const user = pgTable(...); export { user, post as posts };` exports by a list.
  const listed = program.body.flatMap((stmt) =>
    stmt.type === "ExportNamedDeclaration" && stmt.declaration === null && stmt.source === null
      ? stmt.specifiers.flatMap((s) =>
          s.exported.type === "Identifier" && s.exportKind !== "type" ? [s.exported.name] : [],
        )
      : [],
  );
  return [...new Set([...declared, ...listed])];
}

/** A span of the target file as one of the text the editor sent, or null outside it. */
function local(
  span: { readonly start: number; readonly length: number },
  base: number,
  length: number,
) {
  const start = span.start - base;
  const end = start + span.length;
  return start < 0 || end > length ? null : { start, end };
}

/** How the editor marks a diagnostic of this category. */
function severityOf(typescript: TypeScript, category: ts.DiagnosticCategory) {
  if (category === typescript.DiagnosticCategory.Error) return "error" as const;
  if (category === typescript.DiagnosticCategory.Warning) return "warning" as const;
  return "info" as const;
}

/** The lines that give a query `db` and the tables, put in front of it, and what closes it. */
export type QueryPreamble = (input: {
  readonly source: string;
  readonly schemaImport: string;
  readonly names: readonly string[];
}) => { readonly preamble: string; readonly suffix: string };

/**
 * Creates the editor's TypeScript: the project's own `typescript`, loaded the first time it is
 * asked for and kept, over the schema file and a query file beside it, with drizzle-orm's types as
 * installed. It answers completion, details, hover, signature help and type errors.
 *
 * ```mermaid
 * flowchart LR
 *   ask[a request: schema or query text + offset] --> load{loaded?}
 *   load -- no --> ts[(project's node_modules/typescript)] --> host[language service host]
 *   load -- yes --> host
 *   host --> place[put the text in place: the schema, or preamble + query]
 *   place --> svc[TypeScript language service]
 *   svc --> answer[completions / hover / signature / diagnostics]
 *   ts -. missing or TypeScript 7 .-> err[LanguageUnavailableError]
 * ```
 *
 * @param input.schemaPath - the schema file the editor works on
 * @param input.queryPreamble - builds the lines in front of a query from the saved schema
 * @returns the language's operations, each an Effect that loads TypeScript on first use
 */
export function createLanguage(input: {
  readonly schemaPath: string;
  readonly queryPreamble: QueryPreamble;
}) {
  const lock = Semaphore.makeUnsafe(1);
  // The service once it is loaded, kept for every later request.
  const holder = new Map<"loaded", Loaded>();

  const load = Effect.gen(function* () {
    const known = holder.get("loaded");
    if (known !== undefined) return known;
    const typescript = yield* loadTypeScript(input.schemaPath);
    const loaded = makeLanguageHost(typescript, input.schemaPath);
    holder.set("loaded", loaded);
    return loaded;
  }).pipe(Semaphore.withPermit(lock));

  // The preamble of the saved schema it was last built from: every keystroke on the Query page
  // asks again, and the schema rarely changes between them.
  const preambles = new Map<string, ReturnType<QueryPreamble>>();

  function preambleOf(loaded: Loaded, source: string) {
    const known = preambles.get(source);
    if (known !== undefined) return known;
    const made = input.queryPreamble({
      source,
      schemaImport: `./${path.basename(loaded.file)}`,
      names: schemaExports({ source }),
    });
    preambles.clear();
    preambles.set(source, made);
    return made;
  }

  /** The query file's text: the lines in front, the query, and the brace that closes it. */
  function queryText(loaded: Loaded, code: string) {
    const { preamble, suffix } = preambleOf(loaded, loaded.ts.sys.readFile(loaded.file) ?? "");
    return { text: `${preamble}${code}${suffix}`, base: preamble.length };
  }

  /**
   * Puts the text in place and asks about it in one synchronous step, so two requests that
   * arrive together (completion and signature help on one keystroke) cannot swap their texts
   * between the other's edit and question. A query is checked against the saved schema.
   */
  function ask<T>(
    document: DocumentKind,
    text: string,
    offset: number,
    question: (context: {
      readonly loaded: Loaded;
      readonly target: string;
      readonly base: number;
      readonly length: number;
      readonly position: number;
    }) => T,
  ) {
    return Effect.gen(function* () {
      const loaded = yield* load;
      return yield* Effect.sync(() => {
        const schemaText = document === "schema" ? text : null;
        replaceDocument(loaded.documents, "schema", schemaText);
        const placed = document === "query" ? queryText(loaded, text) : { text, base: 0 };
        if (document === "query") replaceDocument(loaded.documents, "query", placed.text);
        return question({
          loaded,
          target: document === "query" ? loaded.queryFile : loaded.file,
          base: placed.base,
          length: text.length,
          position: placed.base + Math.max(0, Math.min(offset, text.length)),
        });
      });
    });
  }

  return {
    typescript: load.pipe(Effect.map((loaded) => loaded.ts)),

    status: load.pipe(
      Effect.match({
        onFailure: (error) => ({ typescript: null, reason: error.reason }),
        onSuccess: (loaded) => ({ typescript: loaded.ts.version, reason: null }),
      }),
    ),

    complete(document: DocumentKind, text: string, offset: number) {
      return ask(document, text, offset, ({ loaded, target, base, length, position }) => {
        const found = loaded.service.getCompletionsAtPosition(target, position, {
          includeCompletionsWithInsertText: true,
          includeCompletionsForModuleExports: false,
        });
        return {
          items: (found?.entries ?? [])
            .filter((entry) => !entry.name.startsWith("__"))
            .map((entry) => ({
              label: entry.name,
              kind: entry.kind,
              sortText: entry.sortText,
              insertText: entry.insertText ?? null,
              replacement: entry.replacementSpan
                ? local(entry.replacementSpan, base, length)
                : null,
            })),
        };
      });
    },

    detail(document: DocumentKind, text: string, offset: number, name: string) {
      return ask(document, text, offset, ({ loaded, target, position }) => {
        const found = loaded.service.getCompletionEntryDetails(
          target,
          position,
          name,
          undefined,
          undefined,
          undefined,
          undefined,
        );
        if (found === undefined) return { detail: null, documentation: null };
        const documentation = loaded.ts.displayPartsToString(found.documentation);
        return {
          detail: loaded.ts.displayPartsToString(found.displayParts) || null,
          documentation: documentation === "" ? null : documentation,
        };
      });
    },

    hover(document: DocumentKind, text: string, offset: number) {
      return ask(document, text, offset, ({ loaded, target, base, length, position }) => {
        const info = loaded.service.getQuickInfoAtPosition(target, position);
        const range = info ? local(info.textSpan, base, length) : null;
        if (info === undefined || range === null) return { contents: null, range: null };
        const signature = loaded.ts.displayPartsToString(info.displayParts);
        const documentation = loaded.ts.displayPartsToString(info.documentation);
        return {
          contents: [
            `\`\`\`typescript\n${signature}\n\`\`\``,
            ...(documentation === "" ? [] : [documentation]),
          ].join("\n\n"),
          range,
        };
      });
    },

    signature(document: DocumentKind, text: string, offset: number) {
      return ask(document, text, offset, ({ loaded, target, position }) => {
        const help = loaded.service.getSignatureHelpItems(target, position, undefined);
        if (help === undefined) return { signatures: [], activeSignature: 0, activeParameter: 0 };
        const parts = loaded.ts.displayPartsToString;
        return {
          signatures: help.items.map((item) => {
            const parameters = item.parameters.map((parameter) => ({
              label: parts(parameter.displayParts),
              documentation: parts(parameter.documentation) || null,
            }));
            return {
              label: `${parts(item.prefixDisplayParts)}${parameters.map((p) => p.label).join(parts(item.separatorDisplayParts))}${parts(item.suffixDisplayParts)}`,
              documentation: parts(item.documentation) || null,
              parameters,
            };
          }),
          activeSignature: help.selectedItemIndex,
          activeParameter: help.argumentIndex,
        };
      });
    },

    /**
     * The type errors of the text. For the schema only the semantic ones: its syntax errors are
     * the parser's, shown with the diagram. A query has no parser of its own, so both.
     */
    diagnostics(document: DocumentKind, text: string) {
      return ask(document, text, 0, ({ loaded, target, base, length }) => {
        const typescript = loaded.ts;
        const found = [
          ...(document === "query" ? loaded.service.getSyntacticDiagnostics(target) : []),
          ...loaded.service.getSemanticDiagnostics(target),
        ];
        return {
          diagnostics: found
            .flatMap((diagnostic) => {
              if (diagnostic.start === undefined) return [];
              const range = local(
                { start: diagnostic.start, length: diagnostic.length ?? 0 },
                base,
                length,
              );
              if (range === null) return [];
              const severity = severityOf(typescript, diagnostic.category);
              return [
                {
                  message: typescript.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
                  severity,
                  range,
                },
              ];
            })
            .toSorted((a, b) => a.range.start - b.range.start),
        };
      });
    },
  };
}

export type Language = ReturnType<typeof createLanguage>;
