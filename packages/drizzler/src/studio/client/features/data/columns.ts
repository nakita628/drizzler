import * as z from "zod";

const HiddenColumnsSchema = z
  .array(z.string().meta({ description: "A column the grid is not showing", example: "bio" }))
  .meta({ description: "The columns folded away on one table, as stored in localStorage" });

/** Where one table's folded-away columns are remembered; each table keeps its own. */
export function columnsStorageKey(table: string) {
  return `drizzler-studio:columns:${table}`;
}

/**
 * The columns a table hides, from what storage kept under its key (read with lib/storage.ts's
 * loadJson): nothing for a value that is missing or not a list of names. What is stored is what
 * is hidden, not what is shown: a column added to the schema afterwards then appears on its own
 * rather than staying invisible until someone goes looking for it.
 */
export function hiddenColumnsOf(stored: unknown): ReadonlySet<string> {
  const result = HiddenColumnsSchema.safeParse(stored);
  return new Set(result.success ? result.data : []);
}
