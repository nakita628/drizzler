import { sqlSchema } from "../helper/index.js";

function isMany(c: string) {
  return c === "many" || c === "zero-many";
}

// DBML has four relationship operators and no notion of zero/optional, so a
// cardinality pair collapses to one of them. The DBML line reads
// `child OP parent`, i.e. left = `to` (child), right = `from` (parent).
// https://dbml.dbdiagram.io/docs/#relationships--foreign-key-definitions
function dbmlOperator(leftMany: boolean, rightMany: boolean) {
  if (leftMany && !rightMany) return ">";
  if (!leftMany && rightMany) return "<";
  if (leftMany && rightMany) return "<>";
  return "-";
}

// A table, column or type name as DBML reads it: bare when it is one word, else double-quoted
// (`"double precision"`, which DBML would otherwise read as the type `double` and a setting).
function name(value: string) {
  return /^[A-Za-z_][\w]*$/u.test(value) ? value : `"${value.replaceAll('"', '\\"')}"`;
}

// A table as DBML names it: `users`, or `auth.users` for a table in a schema of its own.
// https://dbml.dbdiagram.io/docs/#table-definition
function tableName(table: { readonly schema: string | null; readonly bare: string }) {
  return table.schema === null ? name(table.bare) : `${name(table.schema)}.${name(table.bare)}`;
}

// One end of a Ref: `table.column`, or `table.(a, b)` for a composite key.
// https://dbml.dbdiagram.io/docs/#composite-foreign-keys
function endpoint(end: {
  readonly schema: string | null;
  readonly bareTable: string;
  readonly columns: readonly string[];
}) {
  const [only] = end.columns;
  const columns =
    end.columns.length === 1 && only !== undefined
      ? name(only)
      : `(${end.columns.map(name).join(", ")})`;
  return `${tableName({ schema: end.schema, bare: end.bareTable })}.${columns}`;
}

// A column type as DBML reads it: a word with its size or precision (`numeric(10,2)`) as it is,
// anything else as a name.
function typeName(value: string) {
  return /^[A-Za-z_]\w*\(\d+(?:,\d+)?\)$/u.test(value) ? value : name(value);
}

function note(text: string) {
  return `'${text.replaceAll("'", "\\'")}'`;
}

/**
 * The schema as DBML, named as the database names it: a Table per table with its columns (type,
 * `pk`, `increment`, `not null`, `unique`, note), an `indexes` block for a composite primary key,
 * the unique constraints and the indexes, and a Ref per relation.
 */
export function dbml(code: string[]) {
  const { tables, relations } = sqlSchema(code);

  const tableSections = tables.map((table) => {
    const columns = table.columns.map((column) => {
      // https://dbml.dbdiagram.io/docs/#column-settings
      const settings = [
        column.primaryKey ? "pk" : null,
        column.increment ? "increment" : null,
        column.notNull ? "not null" : null,
        column.unique ? "unique" : null,
        column.note !== null ? `note: ${note(column.note)}` : null,
      ].filter((s): s is string => s !== null);
      const settingsStr = settings.length > 0 ? ` [${settings.join(", ")}]` : "";
      return `  ${name(column.name)} ${typeName(column.type)}${settingsStr}`;
    });
    // https://dbml.dbdiagram.io/docs/#index-definition
    const indexes =
      table.indexes.length === 0
        ? []
        : [
            "  indexes {",
            ...table.indexes.map((index) => {
              const settings = [
                index.kind === "pk" ? "pk" : null,
                index.kind === "unique" ? "unique" : null,
                index.using === null ? null : `type: ${index.using}`,
                index.name === null ? null : `name: ${note(index.name)}`,
              ].filter((s): s is string => s !== null);
              const settingsStr = settings.length > 0 ? ` [${settings.join(", ")}]` : "";
              // An index on an expression is written as one, in backticks.
              // https://dbml.dbdiagram.io/docs/#index-definition
              const target =
                index.expression === null
                  ? `(${index.columns.map(name).join(", ")})`
                  : `\`${index.expression.replaceAll("`", "")}\``;
              return `    ${target}${settingsStr}`;
            }),
            "  }",
          ];
    // The comment above the table, as DBML's table note.
    const tableNote = table.note === null ? [] : [`  Note: ${note(table.note)}`];
    const declared = tableName({ schema: table.schema, bare: table.bareName });
    return [`Table ${declared} {`, ...columns, ...indexes, ...tableNote, "}"].join("\n");
  });

  const refSections = relations.map((r) => {
    // DBML puts the child (FK) table on the left: left = `to`, right = `from`.
    const left = endpoint(r.to);
    const right = endpoint(r.from);
    const op = dbmlOperator(isMany(r.to.cardinality), isMany(r.from.cardinality));
    // Physical FKs keep the `_fk` suffix; logical (`defineRelations`-only) ones drop it,
    // since they are not DB-enforced constraints.
    const suffix = r.origin === "inferred" ? "_fk" : "";
    // Named as drizzle-kit names the constraint: by the tables' names without their schemas.
    const refName = `${r.to.bareTable}_${r.to.columns.join("_")}_${r.from.bareTable}_${r.from.columns.join("_")}${suffix}`;
    // https://dbml.dbdiagram.io/docs/#relationship-settings
    const settings = [
      r.onDelete !== null ? `delete: ${r.onDelete}` : null,
      r.onUpdate !== null ? `update: ${r.onUpdate}` : null,
    ].filter((s): s is string => s !== null);
    const settingsStr = settings.length > 0 ? ` [${settings.join(", ")}]` : "";
    const ref = `Ref ${name(refName)}: ${left} ${op} ${right}${settingsStr}`;
    // A key from a column to itself does nothing, but the database keeps it; DBML rejects it
    // ("Two endpoints are the same"), so it is kept as a comment and the file still parses.
    return left === right
      ? `// ${ref} (a key from a column to itself, which DBML cannot express)`
      : ref;
  });

  return [...tableSections, ...refSections].join("\n\n");
}
