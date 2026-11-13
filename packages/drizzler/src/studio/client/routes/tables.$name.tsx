import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";

import { NotFound } from "../components/not-found.js";
import { TableView } from "../features/data/table-view.js";
import { useDocs } from "../hooks/index.js";

export const Route = createFileRoute("/tables/$name")({
  validateSearch: z.object({
    tab: z
      .enum(["data", "columns"])
      .optional()
      .meta({ description: "The tab of the table page", example: "columns" }),
    column: z
      .string()
      .optional()
      .meta({ description: "The column to open the page on", example: "email" }),
  }),
  component: TablePage,
});

function TablePage() {
  const { name } = Route.useParams();
  const { tab, column } = Route.useSearch();
  const docs = useDocs().data ?? null;
  if (docs === null) return <div className="p-6 text-muted">Loading…</div>;
  const table = docs.tables.find((t) => t.name === name);
  return table ? (
    // Keyed on the table, so the search, the page and the dialogs start over for another one.
    <TableView
      key={table.name}
      table={table}
      enums={docs.enums}
      tab={tab ?? null}
      column={column ?? null}
    />
  ) : (
    <NotFound what="table" name={name} />
  );
}
