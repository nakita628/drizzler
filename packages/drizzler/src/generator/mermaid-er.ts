import { mergeRelations, parseTableInfo } from "../helper/index.js";

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
 * Builds a Mermaid erDiagram from the schema code. Relations come from a single
 * merged source (foreign keys + `defineRelations` exports) and are rendered to
 * crow's-foot symbols here, at the output boundary.
 */
export function mermaidER(code: string[]) {
  const tables = parseTableInfo(code);
  const relations = mergeRelations(code);

  const relationLines = relations.map(
    (r) =>
      `    ${r.from.model} ${mermaidRelationSymbol(r)} ${r.to.model} : "(${r.from.field}) - (${r.to.field})"`,
  );

  const tableDefinitions = tables.flatMap((table) => [
    `    ${table.name} {`,
    ...table.fields.map((field) => {
      const keyPart = field.keyType ? ` ${field.keyType}` : "";
      const descPart = field.description ? ` "${field.description}"` : "";
      return `        ${field.type} ${field.name}${keyPart}${descPart}`;
    }),
    "    }",
  ]);

  // A Markdown file ends with a line break, as the formatters write it.
  return `${["```mermaid", "erDiagram", ...relationLines, ...tableDefinitions, "```"].join("\n")}\n`;
}
