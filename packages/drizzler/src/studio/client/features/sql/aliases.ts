// How the SQL editor reads names: a table and its aliases (`FROM users u`), and the word under the
// pointer. Pure, so the editor's hover and completion only ask.

/**
 * A table the editor completes and describes on hover: the name the database knows, what it is,
 * and its columns, each with the name the database knows and its column type.
 */
export type EditorTable = {
  readonly name: string;
  readonly detail: string;
  readonly columns: readonly { readonly name: string; readonly detail: string }[];
};

/** A name as the editor compares it: without its quotes, in lower case. */
export function fold(name: string) {
  return name.replaceAll(/^["`]|["`]$/gu, "").toLowerCase();
}

/** The table every alias in the text stands for (`FROM users u`, `JOIN "Post" AS p`), keyed by the folded alias. */
export function aliasesOf(text: string, tables: readonly EditorTable[]) {
  const known = new Map(tables.map((table) => [fold(table.name), table]));
  const aliases = new Map<string, EditorTable>();
  for (const match of text.matchAll(
    /\b(?:from|join|update|into)\s+("[^"]+"|`[^`]+`|[\w$.]+)(?:\s+(?:as\s+)?("[^"]+"|`[^`]+`|(?!on\b|where\b|set\b|left\b|right\b|inner\b|cross\b|join\b|values\b)[a-z_$][\w$]*))?/giu,
  )) {
    const table = known.get(fold(match[1] ?? ""));
    if (table === undefined) continue;
    aliases.set(fold(match[1] ?? ""), table);
    if (match[2] !== undefined) aliases.set(fold(match[2]), table);
  }
  return aliases;
}

/** The word (letters, digits, `_`, `$`) around a position of the text: where it starts and ends. */
export function wordAround(text: string, at: number) {
  const before = text.slice(0, at).match(/[\w$]*$/u)?.[0].length ?? 0;
  const after = text.slice(at).match(/^[\w$]*/u)?.[0].length ?? 0;
  return { start: at - before, end: at + after };
}
