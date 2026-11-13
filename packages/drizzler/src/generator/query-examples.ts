import { diagramSchema, relationFields } from "../helper/index.js";

type Schema = ReturnType<typeof diagramSchema>;
type Model = Schema["models"][number];
type Field = Model["fields"][number];

/** A Drizzle query to show beside a table: what it does and its code, run as `db.…`. */
export type QueryExample = {
  readonly table: string;
  readonly name: string;
  readonly description: string;
  readonly code: string;
};

/** A query example with the SQL drizzle-orm builds for it, or why it could not. */
export type QueryExampleSql = QueryExample & {
  readonly sql: string | null;
  readonly params: readonly unknown[];
  readonly error: string | null;
};

// Builders whose values the database numbers or that hold numbers, by their Drizzle name.
const SERIALS = new Set(["serial", "smallserial", "bigserial"]);
const NUMBERS = new Set([
  "integer",
  "int",
  "smallint",
  "tinyint",
  "mediumint",
  "bigint",
  "real",
  "doublePrecision",
  "double",
  "float",
]);
const DECIMALS = new Set(["numeric", "decimal"]);
const DATES = new Set(["timestamp", "date", "datetime", "time"]);
const JSONS = new Set(["json", "jsonb"]);

// A value of the column's type for the examples: readable, and what Drizzle accepts for it.
function sampleOf(field: Field, enums: Schema["enums"]) {
  if (field.kind === "enum") {
    const value = enums.find((e) => e.name === field.type)?.values[0]?.name ?? "value";
    return JSON.stringify(value);
  }
  if (field.type === "uuid") return '"00000000-0000-0000-0000-000000000000"';
  if (field.type === "boolean") return "true";
  if (NUMBERS.has(field.type) || SERIALS.has(field.type)) return "1";
  if (DECIMALS.has(field.type)) return '"1.00"';
  if (DATES.has(field.type)) return 'new Date("2026-01-01T00:00:00.000Z")';
  if (JSONS.has(field.type)) return "{}";
  return JSON.stringify(field.name);
}

// Whether an insert has to give the column: NOT NULL, with no default the schema or the database fills.
function mustInsert(field: Field) {
  if (!field.isRequired || SERIALS.has(field.type)) return false;
  return !(field.attributes ?? []).some((note) =>
    /^\.(default|defaultNow|defaultRandom|\$defaultFn|generatedAlwaysAs)\(/u.test(note),
  );
}

function objectOf(fields: readonly Field[], enums: Schema["enums"]) {
  const entries = fields.map((field) => `${field.name}: ${sampleOf(field, enums)}`);
  return entries.length === 0 ? "{}" : `{ ${entries.join(", ")} }`;
}

// The primary key's columns: the `.primaryKey()` column, else the composite key's.
function keyOf(model: Model) {
  const single = model.fields.filter((field) => field.isId);
  if (single.length > 0) return single;
  const composite = new Set(model.primaryKey ?? []);
  return model.fields.filter((field) => composite.has(field.name));
}

// `eq(t.id, …)`, or `and(eq(t.a, …), eq(t.b, …))` for a composite key.
function whereOf(model: Model, key: readonly Field[], enums: Schema["enums"]) {
  const conditions = key.map(
    (field) => `eq(${model.name}.${field.name}, ${sampleOf(field, enums)})`,
  );
  return conditions.length === 1 ? conditions[0] : `and(${conditions.join(", ")})`;
}

function keyedExamples(model: Model, enums: Schema["enums"]): QueryExample[] {
  const t = model.name;
  const key = keyOf(model);
  if (key.length === 0) return [];
  const keyNames = new Set(key.map((field) => field.name));
  const settable = model.fields.find((field) => !keyNames.has(field.name));
  const update =
    settable === undefined
      ? []
      : [
          {
            table: t,
            name: "Update",
            description: `Changes a row of ${t}, found by its primary key.`,
            code: `db.update(${t}).set(${objectOf([settable], enums)}).where(${whereOf(model, key, enums)})`,
          },
        ];
  return [
    {
      table: t,
      name: "Find by primary key",
      description: `One row of ${t}, through the relational query API.`,
      code: `db.query.${t}.findFirst({ where: ${objectOf(key, enums)} })`,
    },
    ...update,
    {
      table: t,
      name: "Delete",
      description: `Deletes a row of ${t}, found by its primary key.`,
      code: `db.delete(${t}).where(${whereOf(model, key, enums)})`,
    },
  ];
}

/**
 * The Drizzle queries the docs show for each table: every row, how many, the rows with their
 * relations, one row by its primary key, and an insert, update and delete, with values of each
 * column's type. Each `code` runs with `db`, the tables, and drizzle-orm's `eq`, `and` and `count`
 * in scope.
 *
 * @param code - the schema's source lines, without their imports
 * @returns the examples of every table, in the order of the schema's tables
 */
export function queryExamples(code: readonly string[]): QueryExample[] {
  const schema = diagramSchema(code);
  const fields = relationFields(code);
  return schema.models.flatMap((model) => {
    const t = model.name;
    const names = fields.filter((f) => f.table === t).map((f) => `${f.name}: true`);
    const withRelations = names.length === 0 ? "" : `{ with: { ${names.join(", ")} } }`;
    return [
      {
        table: t,
        name: "Select",
        description: `Every row of ${t}.`,
        code: `db.select().from(${t})`,
      },
      {
        table: t,
        name: "Count",
        description: `How many rows ${t} has.`,
        code: `db.select({ count: count() }).from(${t})`,
      },
      {
        table: t,
        name: names.length === 0 ? "Find many" : "Find many with relations",
        description:
          names.length === 0
            ? `The rows of ${t}, through the relational query API.`
            : `The rows of ${t} with what they relate to, through the relational query API.`,
        code: `db.query.${t}.findMany(${withRelations})`,
      },
      ...keyedExamples(model, schema.enums).slice(0, 1),
      {
        table: t,
        name: "Insert",
        description: `Adds a row to ${t}, giving the columns that have no default.`,
        code: `db.insert(${t}).values(${objectOf(model.fields.filter(mustInsert), schema.enums)})`,
      },
      ...keyedExamples(model, schema.enums).slice(1),
    ];
  });
}

/**
 * The dialect a schema is written for, from the drizzle-orm core module its files import.
 *
 * @param sources - the text of each schema file, imports included
 * @returns `"pg"`, `"mysql"` or `"sqlite"`, or null when no file imports a core module
 */
export function schemaDialect(sources: readonly string[]) {
  const found = sources
    .map((source) => /["']drizzle-orm\/(pg|mysql|sqlite)-core["']/u.exec(source)?.[1] ?? null)
    .find((dialect) => dialect !== null);
  return found === "pg" || found === "mysql" || found === "sqlite" ? found : null;
}
