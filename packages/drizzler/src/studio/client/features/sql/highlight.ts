// What the SQL page marks on the schema canvas: the tables a statement touches and the columns it
// reads from each, read back from the names the database knows to the exports the pages show.

type Analysed = {
  readonly tables: readonly { readonly name: string; readonly columnsUsed: readonly string[] }[];
} | null;

type Schema = {
  readonly models: readonly {
    readonly name: string;
    readonly dbName: string | null;
    readonly fields: readonly { readonly name: string; readonly dbName?: string | null }[];
  }[];
} | null;

/** The tables a statement touches and the columns it reads from each, keyed by lowercased table name. */
export function highlightOf(statement: Analysed) {
  if (statement === null || statement.tables.length === 0) return null;
  const map = new Map<string, Set<string>>();
  for (const table of statement.tables) {
    const key = table.name.toLowerCase();
    const used = map.get(key) ?? new Set<string>();
    for (const column of table.columnsUsed) used.add(column.toLowerCase());
    map.set(key, used);
  }
  return map;
}

/**
 * The highlight as the canvas keys it: by the table's export and the columns' properties, read
 * back from the names the database knows that the analysis reports.
 */
export function canvasHighlight(
  byName: ReadonlyMap<string, ReadonlySet<string>> | null,
  schema: Schema,
) {
  if (byName === null || schema === null) return null;
  const tables = schema.models.flatMap((model) => {
    const used = byName.get((model.dbName ?? model.name).toLowerCase());
    if (used === undefined) return [];
    const columns = model.fields
      .filter((field) => used.has((field.dbName ?? field.name).toLowerCase()))
      .map((field) => field.name);
    return [[model.name, new Set(columns)] as const];
  });
  return tables.length === 0 ? null : new Map(tables);
}

/** The export of the table the database knows by `table` (any case); null for one the schema lacks. */
export function modelOfTable(schema: Schema, table: string) {
  const key = table.toLowerCase();
  return (
    schema?.models.find((model) => (model.dbName ?? model.name).toLowerCase() === key)?.name ?? null
  );
}
