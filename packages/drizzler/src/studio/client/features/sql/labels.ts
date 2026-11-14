// What the SQL page says and chooses from its state: the result's row count, each statement's tab
// label, which text a run sends, and the tables the editor completes.
import { fieldTypeLabel } from "../diagram/labels.js";

/** The views under the editor. */
export type Tab = "flow" | "columns" | "type" | "result" | "plan";

/**
 * The result's row count. The server sends only the first page of a large result, so the count
 * of what matched and the number of rows on screen can differ; it says so rather than show a
 * wrong total.
 */
export function rowSummary(shown: number, matched: number) {
  const rows = `${matched.toLocaleString()} ${matched === 1 ? "row" : "rows"}`;
  return shown < matched ? `first ${shown.toLocaleString()} of ${rows}` : rows;
}

/** A statement's tab: its number and its first line, cut to fit, or its kind when that is empty. */
export function statementLabel(
  statement: { readonly text: string; readonly kind: string },
  index: number,
) {
  const first = statement.text.trim().split("\n")[0]?.trim() ?? "";
  const short = first.length > 28 ? `${first.slice(0, 27)}…` : first;
  return `${index + 1} · ${short === "" ? statement.kind : short}`;
}

/** The view a tab key names; the flow for any other. */
export function tabOf(key: string | number): Tab {
  const name = String(key);
  return name === "columns" || name === "type" || name === "result" || name === "plan"
    ? name
    : "flow";
}

/**
 * What a run or an explain sends: the whole text when it holds one statement (or none is chosen),
 * else the chosen statement alone.
 */
export function textToRun(
  sql: string,
  statement: { readonly text: string } | null,
  statementCount: number,
) {
  return statement === null || statementCount <= 1 ? sql : statement.text;
}

/**
 * The tables the editor completes and describes on hover: the names the database knows, over the
 * exports and properties, with each column's type beside it.
 */
export function editorTables(
  models: readonly {
    readonly name: string;
    readonly dbName: string | null;
    readonly fields: readonly (Parameters<typeof fieldTypeLabel>[0] & {
      readonly name: string;
      readonly dbName?: string | null;
    })[];
  }[],
) {
  return models.map((model) => ({
    name: model.dbName ?? model.name,
    detail: `table ${model.name}`,
    columns: model.fields.map((field) => ({
      name: field.dbName ?? field.name,
      detail: fieldTypeLabel(field),
    })),
  }));
}
