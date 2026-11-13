import { diagramSchema, relationFields } from "../helper/index.js";
import { makeDocs } from "../studio/server/domain/docs.js";
import type { QueryExampleSql } from "./query-examples.js";
import { layoutSql } from "./sql-layout.js";

type Docs = ReturnType<typeof makeDocs>;
type Table = Docs["tables"][number];
type Column = Table["columns"][number];
type Relation = Table["references"][number];

/** The files a docs directory holds besides its README, as the README links them. */
export const DOCS_FILES = {
  diagram: "er.svg",
  // One ER diagram per table that has a relation: the table and the tables it joins.
  tables: "tables",
} as const;

/**
 * Where a table's own ER diagram sits in a docs directory, as the README links it.
 *
 * @param table - the table's export name
 * @returns the path relative to the docs directory
 */
export function tableDiagramPath(table: string) {
  return `${DOCS_FILES.tables}/${table}.svg`;
}

// A table cell's text: a pipe would end the cell, a line break the row.
function cell(text: string) {
  return text.replaceAll("|", "\\|").replaceAll(/\r?\n/gu, " ");
}

// Inline code, fenced with more backticks than the text holds (`` `x` `` for a text with one).
function inline(text: string) {
  const longest = Math.max(0, ...[...text.matchAll(/`+/gu)].map((m) => m[0].length));
  const fence = "`".repeat(longest + 1);
  const pad = text.startsWith("`") || text.endsWith("`") ? " " : "";
  return `${fence}${pad}${text}${pad}${fence}`;
}

// The anchor of a table or an enum, as the studio's Docs page names it.
function anchor(kind: "table" | "enum", name: string) {
  return `${kind}-${name}`;
}

function heading(level: number, kind: "table" | "enum", name: string) {
  return `<a id="${anchor(kind, name)}"></a>\n\n${"#".repeat(level)} ${name}`;
}

function typeOf(column: Column, enums: ReadonlySet<string>) {
  const type = inline(`${column.type}${column.isList ? "[]" : ""}`);
  return column.enumName !== null && enums.has(column.enumName)
    ? `[${type}](#${anchor("enum", column.enumName)})`
    : type;
}

function constraintsOf(column: Column) {
  const reference =
    column.references === null
      ? []
      : [
          `→ [${column.references.table}.${column.references.column}](#${anchor("table", column.references.table)})`,
        ];
  return [
    ...(column.primaryKey ? ["PK"] : []),
    ...(column.unique ? ["UNIQUE"] : []),
    column.nullable ? "NULL" : "NOT NULL",
    ...reference,
  ].join(" ");
}

function columnsOf(table: Table, enums: ReadonlySet<string>) {
  const rows = table.columns.map((column) => {
    const name =
      column.dbName === column.name
        ? inline(column.name)
        : `${inline(column.name)} (${inline(column.dbName)})`;
    const defaults = column.defaults.map(inline).join(" ");
    return `| ${cell(name)} | ${cell(typeOf(column, enums))} | ${cell(constraintsOf(column))} | ${cell(defaults)} | ${cell(column.description ?? "")} |`;
  });
  return [
    "| Column | Type | Constraints | Default | Description |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

function indexLabel(type: string) {
  if (type === "id") return "PRIMARY KEY";
  if (type === "normal") return "INDEX";
  return type.toUpperCase();
}

function indexesOf(table: Table) {
  if (table.indexes.length === 0) return [];
  const lines = table.indexes.map(
    (index) => `- ${indexLabel(index.type)} ${index.columns.map(inline).join(", ")}`,
  );
  return [`#### Indexes\n\n${lines.join("\n")}`];
}

function relationNote(relation: Relation, reverse: boolean) {
  const actions = [
    ...(relation.onDelete ? [`on delete ${relation.onDelete}`] : []),
    ...(relation.onUpdate ? [`on update ${relation.onUpdate}`] : []),
  ];
  const origin = reverse ? "defineRelations" : "defineRelations, no foreign key";
  return [relation.kind, ...actions, ...(relation.origin === "relations" ? [origin] : [])].join(
    ", ",
  );
}

function relationsOf(title: string, relations: readonly Relation[], reverse: boolean) {
  if (relations.length === 0) return [];
  const lines = relations.map(
    (relation) =>
      `- ${inline(relation.column)} → [${relation.table}.${relation.otherColumn}](#${anchor("table", relation.table)}) (${relationNote(relation, reverse)})`,
  );
  return [`#### ${title}\n\n${lines.join("\n")}`];
}

// The studio's queries, code only: what the docs show when the schema could not be loaded.
function codeQueriesOf(table: Table) {
  if (table.queries.length === 0) return [];
  const blocks = table.queries.map(
    (query) => `**${query.name}**: ${query.description}\n\n\`\`\`ts\n${query.code}\n\`\`\``,
  );
  return [`<details>\n<summary>Queries</summary>\n\n${blocks.join("\n\n")}\n\n</details>`];
}

function sqlBlockOf(example: QueryExampleSql) {
  if (example.sql === null) {
    return `> drizzle-orm could not build its SQL: ${example.error ?? "unknown error"}`;
  }
  const params =
    example.params.length === 0 ? "" : `\n-- params: ${JSON.stringify(example.params)}`;
  return `\`\`\`sql\n${layoutSql(example.sql)}${params}\n\`\`\``;
}

// Each query in Drizzle beside the SQL drizzle-orm builds for it.
function sqlQueriesOf(examples: readonly QueryExampleSql[]) {
  if (examples.length === 0) return [];
  const blocks = examples.map(
    (example) =>
      `**${example.name}**: ${example.description}\n\n\`\`\`ts\n${example.code}\n\`\`\`\n\n${sqlBlockOf(example)}`,
  );
  return [
    `<details>\n<summary>Queries and their SQL</summary>\n\n${blocks.join("\n\n")}\n\n</details>`,
  ];
}

// A statement's subject: the table it creates, alters or indexes, or the type it creates, by the
// last quoted name (`"auth"."user"` is `user`; MySQL quotes with backticks).
const NAME = '((?:[`"][^`"]+[`"]\\.)?[`"]([^`"]+)[`"])';
const SUBJECTS = [
  {
    kind: "table",
    pattern: new RegExp(`^\\s*CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${NAME}`, "iu"),
  },
  { kind: "table", pattern: new RegExp(`^\\s*ALTER\\s+TABLE\\s+(?:ONLY\\s+)?${NAME}`, "iu") },
  {
    kind: "table",
    pattern: new RegExp(
      `^\\s*CREATE\\s+(?:UNIQUE\\s+)?INDEX\\b[\\s\\S]*?\\bON\\s+(?:ONLY\\s+)?${NAME}`,
      "iu",
    ),
  },
  { kind: "enum", pattern: new RegExp(`^\\s*CREATE\\s+TYPE\\s+${NAME}`, "iu") },
] as const;

/**
 * Each table's and enum's own statements of a migration, by `table:<db name>` and
 * `enum:<db name>`, in the order the migration has them.
 *
 * @param statements - the statements drizzle-kit wrote
 * @returns the statements, grouped by what they define
 */
export function ddlBySubject(statements: readonly string[]) {
  const keyed = statements.flatMap((statement) => {
    const subject = SUBJECTS.map(({ kind, pattern }) => {
      const name = pattern.exec(statement)?.[2];
      return name === undefined ? null : `${kind}:${name}`;
    }).find((key) => key !== null);
    return subject === undefined || subject === null ? [] : [[subject, statement] as const];
  });
  return new Map(
    [...Map.groupBy(keyed, ([key]) => key)].map(([key, group]) => [
      key,
      group.map(([, statement]) => statement),
    ]),
  );
}

// Every statement of the schema in one folded block, in drizzle-kit's order.
function wholeSqlOf(statements: readonly string[]) {
  if (statements.length === 0) return [];
  return [
    `<details>\n<summary>The whole schema as SQL</summary>\n\n\`\`\`sql\n${statements.join("\n\n")}\n\`\`\`\n\n</details>`,
  ];
}

function definitionOf(statements: readonly string[] | undefined) {
  if (statements === undefined || statements.length === 0) return [];
  return [`#### Definition\n\n\`\`\`sql\n${statements.join("\n\n")}\n\`\`\``];
}

function tableSection(
  table: Table,
  enums: ReadonlySet<string>,
  queries: ReadonlyMap<string, readonly QueryExampleSql[]> | null,
  ddl: ReadonlyMap<string, readonly string[]>,
) {
  const names = table.dbName === table.name ? [] : [`Table ${inline(table.dbName)}.`];
  const intro = [...names, ...(table.description ? [table.description] : [])].join(" ");
  const related = table.references.length > 0 || table.referencedBy.length > 0;
  const diagram = [
    related
      ? `![${table.name} and the tables it relates to](${tableDiagramPath(table.name)})`
      : `![${table.name}](${tableDiagramPath(table.name)})`,
  ];
  return [
    heading(3, "table", table.name),
    ...(intro === "" ? [] : [intro]),
    ...diagram,
    columnsOf(table, enums),
    ...definitionOf(ddl.get(`table:${table.dbName}`)),
    ...indexesOf(table),
    ...relationsOf("References", table.references, false),
    ...relationsOf("Referenced by", table.referencedBy, true),
    ...(queries === null ? codeQueriesOf(table) : sqlQueriesOf(queries.get(table.name) ?? [])),
  ].join("\n\n");
}

function enumSection(value: Docs["enums"][number], ddl: ReadonlyMap<string, readonly string[]>) {
  const names = value.dbName === value.name ? [] : [`Type ${inline(value.dbName)}.`];
  const intro = [...names, ...(value.description ? [value.description] : [])].join(" ");
  return [
    heading(3, "enum", value.name),
    ...(intro === "" ? [] : [intro]),
    value.values.map((v) => `- ${inline(v)}`).join("\n"),
    ...definitionOf(ddl.get(`enum:${value.dbName}`)),
  ].join("\n\n");
}

function contentsOf(docs: Docs) {
  const tables = docs.tables.map(
    (table) =>
      `| [${table.name}](#${anchor("table", table.name)}) | ${inline(table.dbName)} | ${cell(table.description ?? "")} |`,
  );
  const enums = docs.enums.map(
    (value) =>
      `| [${value.name}](#${anchor("enum", value.name)}) | ${inline(value.dbName)} | ${cell(value.description ?? "")} |`,
  );
  return [
    ["| Table | Name in the database | Description |", "| --- | --- | --- |", ...tables].join("\n"),
    ...(enums.length === 0
      ? []
      : [
          ["| Enum | Name in the database | Description |", "| --- | --- | --- |", ...enums].join(
            "\n",
          ),
        ]),
  ];
}

/**
 * The schema's documentation as Markdown, the Docs page of the studio as a file: every table with
 * its columns, constraints, defaults, indexes, relations both ways and Drizzle queries, and every
 * enum, each described by the comment above it; the ER diagram of the same directory and the
 * whole schema as SQL (folded) at the top.
 *
 * @param code - the schema's source lines, without their imports
 * @param options.queries - each table's queries with the SQL drizzle-orm builds for them; when
 *   null (the schema could not be loaded), the studio's queries are shown as code only
 * @param options.ddl - the statements drizzle-kit writes for the schema; each table and enum shows
 *   its own under its columns or values
 * @returns the README.md of a docs directory
 */
export function docsMarkdown(
  code: readonly string[],
  options: {
    readonly queries?: readonly QueryExampleSql[] | null;
    readonly ddl?: readonly string[] | null;
  } = {},
) {
  const queries =
    options.queries === null || options.queries === undefined
      ? null
      : Map.groupBy(options.queries, (query) => query.table);
  const ddl = ddlBySubject(options.ddl ?? []);
  const docs = makeDocs({ ...diagramSchema(code), relationFields: relationFields(code) });
  const enums = new Set(docs.enums.map((e) => e.name));
  return `${[
    "# Schema docs",
    `![ER diagram](${DOCS_FILES.diagram})`,
    ...wholeSqlOf(options.ddl ?? []),
    "## Contents",
    ...contentsOf(docs),
    "## Tables",
    ...docs.tables.map((table) => tableSection(table, enums, queries, ddl)),
    ...(docs.enums.length === 0
      ? []
      : ["## Enums", ...docs.enums.map((value) => enumSection(value, ddl))]),
  ].join("\n\n")}\n`;
}
