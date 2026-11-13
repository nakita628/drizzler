import { mergeRelations, parseTableInfo } from "../helper/index.js";

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

/** The schema as DBML: a Table per table with its columns and notes, and a Ref per relation. */
export function dbml(code: string[]) {
  const TYPE_MAP: { readonly [k: string]: string } = {
    serial: "serial",
    smallserial: "smallserial",
    bigserial: "bigserial",
    integer: "integer",
    int: "integer",
    smallint: "smallint",
    bigint: "bigint",
    boolean: "boolean",
    text: "text",
    varchar: "varchar",
    char: "char",
    numeric: "numeric",
    decimal: "decimal",
    real: "real",
    doublePrecision: "double precision",
    json: "json",
    jsonb: "jsonb",
    timestamp: "timestamp",
    timestamptz: "timestamptz",
    date: "date",
    time: "time",
    interval: "interval",
    uuid: "uuid",
    blob: "blob",
    bytea: "bytea",
  };
  const tables = parseTableInfo(code);
  const relations = mergeRelations(code);

  const tableSections = tables.map((table) => {
    const columns = table.fields.map((field) => {
      const type = TYPE_MAP[field.type] ?? field.type;
      const constraints = [
        field.keyType === "PK" ? "pk" : null,
        field.type.includes("serial") ? "increment" : null,
        field.description ? `note: '${field.description.replace(/'/g, "\\'")}'` : null,
      ].filter((c): c is string => c !== null);
      const constraintStr = constraints.length > 0 ? ` [${constraints.join(", ")}]` : "";
      return `  ${field.name} ${type}${constraintStr}`;
    });
    // The comment above the table, as DBML's table note.
    const note =
      table.description === null ? [] : [`  Note: '${table.description.replace(/'/g, "\\'")}'`];
    return [`Table ${table.name} {`, ...columns, ...note, "}"].join("\n");
  });

  const refSections = relations.map((r) => {
    // DBML puts the child (FK) table on the left: left = `to`, right = `from`.
    const left = `${r.to.model}.${r.to.field}`;
    const right = `${r.from.model}.${r.from.field}`;
    const op = dbmlOperator(isMany(r.to.cardinality), isMany(r.from.cardinality));
    // Physical FKs keep the `_fk` suffix; logical (`defineRelations`-only) ones drop it,
    // since they are not DB-enforced constraints.
    const suffix = r.origin === "inferred" ? "_fk" : "";
    const name = `${r.to.model}_${r.to.field}_${r.from.model}_${r.from.field}${suffix}`;
    return `Ref ${name}: ${left} ${op} ${right}`;
  });

  return [...tableSections, ...refSections].join("\n\n");
}
