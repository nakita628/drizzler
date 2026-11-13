/**
 * The table the data pages draw: the docs' account of each column (its type, key, default and
 * reference) is what the headers, the details panel and the editors read.
 */
export type GridColumn = {
  readonly name: string;
  readonly dbName: string;
  readonly type: string;
  readonly nullable: boolean;
  readonly primaryKey: boolean;
  readonly unique: boolean;
  readonly isList: boolean;
  readonly enumName: string | null;
  readonly defaults: readonly string[];
  readonly description: string | null;
  readonly references: { readonly table: string; readonly column: string } | null;
};

export type GridTable = {
  readonly name: string;
  readonly dbName: string;
  readonly description: string | null;
  readonly columns: readonly GridColumn[];
  readonly indexes: readonly { readonly type: string; readonly columns: readonly string[] }[];
  readonly references: readonly GridRelation[];
  readonly referencedBy: readonly GridRelation[];
};

export type GridRelation = {
  readonly table: string;
  readonly column: string;
  readonly otherColumn: string;
  readonly kind: string;
  readonly origin: string;
  readonly onDelete: string | null;
  readonly onUpdate: string | null;
};

export type GridEnum = { readonly name: string; readonly values: readonly string[] };

/** `integer`, `text?`, `role[]`: the builder, a list, and whether it may be null. */
export function columnTypeLabel(column: Pick<GridColumn, "type" | "isList" | "nullable">) {
  return `${column.type}${column.isList ? "[]" : ""}${column.nullable ? "?" : ""}`;
}

/** The column as the key and link marks read it. */
export function iconField(column: GridColumn) {
  return { name: column.name, isId: column.primaryKey, isForeignKey: column.references !== null };
}

/** What a column carries besides its type, written as short chips: its key, uniqueness, default. */
export function columnAttributes(column: GridColumn) {
  return [
    ...(column.primaryKey ? ["primary key"] : []),
    ...(column.unique && !column.primaryKey ? ["unique"] : []),
    ...column.defaults,
    ...(column.references ? [`→ ${column.references.table}.${column.references.column}`] : []),
  ];
}

/** The values a cell editor offers as a list: an enum's, or true and false. */
export function optionsFor(enums: readonly GridEnum[], column: GridColumn) {
  if (column.enumName !== null) {
    return enums.find((value) => value.name === column.enumName)?.values ?? [];
  }
  return column.type === "boolean" && !column.isList ? ["true", "false"] : null;
}
