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
  return /^[A-Za-z_][\w]*$/u.test(value) ? value : `"${value.replace(/"/gu, '\\"')}"`;
}

function note(text: string) {
  return `'${text.replace(/'/gu, "\\'")}'`;
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
        column.note ? `note: ${note(column.note)}` : null,
      ].filter((s): s is string => s !== null);
      const settingsStr = settings.length > 0 ? ` [${settings.join(", ")}]` : "";
      return `  ${name(column.name)} ${name(column.type)}${settingsStr}`;
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
                index.name === null ? null : `name: ${note(index.name)}`,
              ].filter((s): s is string => s !== null);
              const settingsStr = settings.length > 0 ? ` [${settings.join(", ")}]` : "";
              return `    (${index.columns.map(name).join(", ")})${settingsStr}`;
            }),
            "  }",
          ];
    // The comment above the table, as DBML's table note.
    const tableNote = table.note === null ? [] : [`  Note: ${note(table.note)}`];
    return [`Table ${name(table.name)} {`, ...columns, ...indexes, ...tableNote, "}"].join("\n");
  });

  const refSections = relations.map((r) => {
    // DBML puts the child (FK) table on the left: left = `to`, right = `from`.
    const left = `${name(r.to.table)}.${name(r.to.column)}`;
    const right = `${name(r.from.table)}.${name(r.from.column)}`;
    const op = dbmlOperator(isMany(r.to.cardinality), isMany(r.from.cardinality));
    // Physical FKs keep the `_fk` suffix; logical (`defineRelations`-only) ones drop it,
    // since they are not DB-enforced constraints.
    const suffix = r.origin === "inferred" ? "_fk" : "";
    const refName = `${r.to.table}_${r.to.column}_${r.from.table}_${r.from.column}${suffix}`;
    // https://dbml.dbdiagram.io/docs/#relationship-settings
    const settings = [
      r.onDelete ? `delete: ${r.onDelete}` : null,
      r.onUpdate ? `update: ${r.onUpdate}` : null,
    ].filter((s): s is string => s !== null);
    const settingsStr = settings.length > 0 ? ` [${settings.join(", ")}]` : "";
    return `Ref ${name(refName)}: ${left} ${op} ${right}${settingsStr}`;
  });

  return [...tableSections, ...refSections].join("\n\n");
}
