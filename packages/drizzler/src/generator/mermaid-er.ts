import { sqlSchema } from "../helper/index.js";
import type { Cardinality } from "../types/index.js";

// Mermaid crow's-foot tokens. Per the Mermaid ER spec the right side is the
// mirror of the left, e.g. "one or more" is `}|` on the left but `|{` on the
// right. https://mermaid.js.org/syntax/entityRelationshipDiagram.html
// MERMAID_LEFT is the canonical key set; MERMAID_RIGHT must mirror its keys.
const MERMAID_LEFT = {
  "zero-one": "|o",
  one: "||",
  "zero-many": "}o",
  many: "}|",
} as const;

const MERMAID_RIGHT = {
  "zero-one": "o|",
  one: "||",
  "zero-many": "o{",
  many: "|{",
} as const satisfies Record<keyof typeof MERMAID_LEFT, string>;

/** The Mermaid erDiagram connector for a relation: its two cardinalities, solid for a foreign key, dotted otherwise. */
export function mermaidRelationSymbol(r: {
  readonly from: { readonly cardinality: keyof typeof MERMAID_LEFT };
  readonly to: { readonly cardinality: keyof typeof MERMAID_LEFT };
  readonly identifying: boolean;
}) {
  return `${MERMAID_LEFT[r.from.cardinality]}${r.identifying ? "--" : ".."}${MERMAID_RIGHT[r.to.cardinality]}`;
}

/**
 * How many rows each end of a foreign key has, as Mermaid draws it. A parent may have no child
 * at all, so the child end is zero or more (zero or one when the key column is unique); a child
 * has exactly one parent when the key is NOT NULL, and zero or one when it may be null. The
 * relation's own child cardinality says both: `one` / `many` for NOT NULL, `one` / `zero-one`
 * for unique.
 */
export function mermaidCardinalities(child: Cardinality) {
  const required = child === "one" || child === "many";
  const unique = child === "one" || child === "zero-one";
  return {
    from: required ? ("one" as const) : ("zero-one" as const),
    to: unique ? ("zero-one" as const) : ("zero-many" as const),
  };
}

// An entity or attribute name as Mermaid reads it: bare when it is one word, else quoted.
function entity(value: string) {
  return /^[A-Za-z_][\w-]*$/u.test(value) ? value : `"${value.replace(/"/gu, "'")}"`;
}

// An attribute type as Mermaid reads it: one word, so `double precision` is `double_precision`.
function attributeType(value: string) {
  return value.replace(/\s+/gu, "_");
}

/**
 * Builds a Mermaid erDiagram from the schema code, named as the database names it: each table
 * and column by its SQL name, each column by its SQL type with its keys (`PK`, `FK`), and
 * a line per relation (foreign keys and `defineRelations` exports), solid for a foreign key.
 */
export function mermaidER(code: string[]) {
  const { tables, relations } = sqlSchema(code);

  const relationLines = relations.map((r) => {
    const ends = mermaidCardinalities(r.to.cardinality);
    const symbol = mermaidRelationSymbol({
      from: { cardinality: ends.from },
      to: { cardinality: ends.to },
      identifying: r.origin === "inferred",
    });
    return `    ${entity(r.from.table)} ${symbol} ${entity(r.to.table)} : "(${r.from.column}) - (${r.to.column})"`;
  });

  const tableDefinitions = tables.flatMap((table) => {
    const keyed = new Set(table.indexes.flatMap((i) => (i.kind === "pk" ? i.columns : [])));
    return [
      `    ${entity(table.name)} {`,
      ...table.columns.map((column) => {
        const keys = [
          column.primaryKey || keyed.has(column.name) ? "PK" : null,
          column.foreignKey ? "FK" : null,
        ].filter((k): k is string => k !== null);
        const keyPart = keys.length > 0 ? ` ${keys.join(", ")}` : "";
        const descPart = column.note ? ` "${column.note.replace(/"/gu, "'")}"` : "";
        return `        ${attributeType(column.type)} ${entity(column.name)}${keyPart}${descPart}`;
      }),
      "    }",
    ];
  });

  // A Markdown file ends with a line break, as the formatters write it.
  return `${["```mermaid", "erDiagram", ...relationLines, ...tableDefinitions, "```"].join("\n")}\n`;
}
