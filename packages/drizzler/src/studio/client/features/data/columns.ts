import * as z from "zod";

import { loadString, saveString } from "../../lib/storage.js";

const HiddenColumnsSchema = z
  .array(z.string().meta({ description: "A column the grid is not showing", example: "bio" }))
  .meta({ description: "The columns folded away on one table, as stored in localStorage" });

/** Where one table's folded-away columns are remembered; each table keeps its own. */
export function columnsStorageKey(table: string) {
  return `drizzler-studio:columns:${table}`;
}

/**
 * What is stored is what is hidden, not what is shown: a column added to the schema afterwards
 * then appears on its own rather than staying invisible until someone goes looking for it.
 */
export function loadHiddenColumns(table: string): ReadonlySet<string> {
  try {
    const raw = loadString(columnsStorageKey(table));
    if (raw === null) return new Set();
    const json: unknown = JSON.parse(raw);
    const result = HiddenColumnsSchema.safeParse(json);
    return new Set(result.success ? result.data : []);
  } catch {
    return new Set();
  }
}

/** Remembers which columns of a table the grid hides. */
export function saveHiddenColumns(table: string, hidden: ReadonlySet<string>) {
  saveString(columnsStorageKey(table), JSON.stringify([...hidden]));
}
