import { Button, buttonVariants, Dropdown, SearchField, Tabs, toast, Tooltip } from "@heroui/react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  LuCopy,
  LuDownload,
  LuFileText,
  LuGitCompare,
  LuInfo,
  LuPlus,
  LuTrash2,
  LuX,
} from "react-icons/lu";

import { ColumnsPicker } from "../../components/columns-picker.js";
import { ColumnsTable } from "../../components/columns-table.js";
import { ConfirmDialog } from "../../components/confirm-dialog.js";
import { DataGrid } from "../../components/data-grid.js";
import { DetailsPanel } from "../../components/details-panel.js";
import {
  getDbKey,
  getDbRowsTableNameQueryOptions,
  useDb,
  useDeleteDbRowsTableName,
  usePatchDbRowsTableName,
  usePostDbRowsTableName,
} from "../../hooks/index.js";
import { copyText } from "../../lib/copy.js";
import { useDebounced } from "../../lib/debounce.js";
import { downloadFile } from "../../lib/download.js";
import { problemMessage } from "../../lib/problem.js";
import { keyLabel, keyOf, rowId, toCsv, toJson, toTsv } from "./cells.js";
import { loadHiddenColumns, saveHiddenColumns } from "./columns.js";
import { PAGE_SIZE } from "./paging.js";
import type { GridEnum, GridTable } from "./table.js";

type Row = Record<string, string | number | boolean | null>;

/** How long the box may go on being typed in before the query behind it is worth a round trip. */
const SEARCH_DELAY_MS = 250;

function plural(count: number) {
  return count === 1 ? "row" : "rows";
}

/**
 * One table: its rows, a page at a time, searched, edited in place, copied and exported, or its
 * columns as the schema declares them — with the details of the table beside either.
 */
export function TableView({
  table,
  enums,
  tab,
  column,
}: {
  readonly table: GridTable;
  readonly enums: readonly GridEnum[];
  readonly tab: "data" | "columns" | null;
  /** A column to open on and point at, as the palette hands one over. */
  readonly column: string | null;
}) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const database = useDb().data ?? null;
  const connected = database?.connected ?? false;
  const rowKey = database?.tables.find((t) => t.name === table.name)?.key ?? [];
  // A link that names a column means the columns, whichever tab the database would have opened.
  const activeTab: "data" | "columns" = tab ?? (column === null && connected ? "data" : "columns");
  const [query, setQuery] = useState("");
  const [skip, setSkip] = useState(0);
  const [details, setDetails] = useState(true);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pending, setPending] = useState<readonly Row[] | null>(null);
  // Which columns are folded away, per table and remembered. Everything that copies or exports
  // takes what is on screen, so this is also how a copy is narrowed to two columns of forty.
  const [hidden, setHidden] = useState(() => loadHiddenColumns(table.name));
  const searchBox = useRef<HTMLInputElement>(null);
  // The box holds what is being typed; the query behind it settles first, so a table of a million
  // rows is read once per pause rather than once per letter.
  const applied = useDebounced(query, SEARCH_DELAY_MS);

  // `/` is the search key of every list on the web. It only counts where nothing else is taking
  // letters — a cell editor, the editors and the palette all read a slash as a slash.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT");
      if (typing) return;
      event.preventDefault();
      searchBox.current?.focus();
    }
    globalThis.addEventListener("keydown", onKeyDown);
    return () => {
      globalThis.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const rows = useQuery({
    ...getDbRowsTableNameQueryOptions({
      param: { tableName: table.name },
      query: { skip: String(skip), take: String(PAGE_SIZE), search: applied },
    }),
    enabled: connected && activeTab === "data",
    placeholderData: keepPreviousData,
    retry: false,
  });
  // The row counts in the sidebar are of the database too.
  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: getDbKey() });
  }
  const insert = usePostDbRowsTableName({
    mutation: {
      async onSuccess() {
        setAdding(false);
        await invalidate();
        toast.success("Row added");
      },
      onError(error) {
        toast.danger(problemMessage(error));
      },
    },
  });
  const update = usePatchDbRowsTableName({
    mutation: {
      onSuccess: invalidate,
      onError(error) {
        toast.danger(problemMessage(error));
      },
    },
  });
  // Deleting is the one mutation that runs in batches, so it reports once for the batch instead
  // of once per row: the toasts and the refetch are driven from `confirmDelete` below.
  const remove = useDeleteDbRowsTableName();
  const saving = insert.isPending || update.isPending || remove.isPending;
  const page = rows.data ?? null;
  const all = table.columns.map((c) => c.name);
  const columns = all.filter((name) => !hidden.has(name));
  const param = { tableName: table.name };
  const pageRows = page?.rows ?? [];
  const chosen = pageRows.filter((row) => selected.has(rowId(row, rowKey)));

  function clearSelection() {
    setSelected(new Set());
  }

  function hideColumns(next: ReadonlySet<string>) {
    setHidden(next);
    saveHiddenColumns(table.name, next);
  }

  function search(value: string) {
    setQuery(value);
    setSkip(0);
    clearSelection();
  }

  function goToPage(next: number) {
    setSkip(next);
    clearSelection();
  }

  function confirmDelete() {
    const doomed = pending ?? [];
    async function run() {
      const settled = await Promise.allSettled(
        doomed.map((row) => remove.mutateAsync({ param, json: { where: keyOf(row, rowKey) } })),
      );
      const failed = settled.filter((result) => result.status === "rejected").length;
      const deleted = doomed.length - failed;
      setPending(null);
      clearSelection();
      await invalidate();
      if (deleted > 0) toast.success(`${deleted} ${plural(deleted)} deleted`);
      if (failed > 0) toast.danger(`${failed} ${plural(failed)} could not be deleted.`);
    }
    void run();
  }

  function exportRows(action: string | number) {
    if (!page) return;
    if (action === "csv") {
      downloadFile(
        `${table.name}.csv`,
        new Blob([toCsv(columns, page.rows)], { type: "text/csv" }),
      );
    }
    if (action === "json") {
      downloadFile(
        `${table.name}.json`,
        new Blob([toJson(columns, page.rows)], { type: "application/json" }),
      );
    }
    if (action === "copy-csv") copyText(toCsv(columns, page.rows), "This page (CSV)");
    if (action === "copy-json") copyText(toJson(columns, page.rows), "This page (JSON)");
    if (action === "copy-tsv") copyText(toTsv(columns, page.rows), "This page");
  }

  function dataPane() {
    if (!connected) {
      return (
        <div className="m-6 rounded-[10px] border border-line bg-surface p-5 text-muted">
          <div className="mb-1 font-semibold text-ink">No database connected</div>
          <pre className="m-0 font-mono text-code whitespace-pre-wrap">
            {database?.error ??
              "Start the studio with --url <connection string> or set DATABASE_URL."}
          </pre>
        </div>
      );
    }
    if (rows.isError) {
      return <div className="error-box m-6">{problemMessage(rows.error)}</div>;
    }
    if (page === null) {
      return <div className="p-6 text-muted">Loading rows…</div>;
    }
    return (
      <DataGrid
        schema={{ enums }}
        model={table}
        rows={page.rows}
        rowKey={rowKey}
        hiddenColumns={hidden}
        total={page.total}
        skip={page.skip}
        search={applied}
        loading={rows.isFetching}
        saving={saving}
        adding={adding}
        selected={selected}
        onSelectedChange={setSelected}
        onAddingChange={setAdding}
        onPage={goToPage}
        onClearSearch={() => {
          search("");
        }}
        onInsert={(values: Row) => {
          insert.mutate({ param, json: { values } });
        }}
        onUpdate={(where, values) => {
          update.mutate({ param, json: { where, values } });
        }}
        onDeleteRequest={setPending}
      />
    );
  }

  return (
    <section
      className={`grid min-h-0 flex-1 overflow-hidden ${details ? "grid-cols-[minmax(0,1fr)_320px]" : "grid-cols-[minmax(0,1fr)]"}`}
    >
      <div className="flex min-h-0 min-w-0 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-6 py-3">
          <h1 className="page-title">{table.name}</h1>
          {table.dbName !== table.name ? (
            <span className="font-mono text-ui text-muted">{table.dbName}</span>
          ) : null}
          <SearchField
            className="min-w-[200px] flex-1"
            aria-label={activeTab === "data" ? "Search every column" : "Search the columns"}
            value={query}
            onChange={search}
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input
                ref={searchBox}
                placeholder={activeTab === "data" ? "Search every column…" : "Search the columns…"}
              />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          {activeTab === "data" ? (
            <>
              <Button
                variant="outline"
                isDisabled={!connected}
                onPress={() => {
                  setAdding(true);
                }}
              >
                <LuPlus size={15} />
                Add row
              </Button>
              <Dropdown>
                <Button variant="outline" isDisabled={!page}>
                  <LuDownload size={15} />
                  Export
                </Button>
                <Dropdown.Popover placement="bottom start">
                  <Dropdown.Menu aria-label="Export this page of rows" onAction={exportRows}>
                    <Dropdown.Item id="csv" textValue="Download CSV">
                      <LuDownload size={14} />
                      Download CSV
                    </Dropdown.Item>
                    <Dropdown.Item id="json" textValue="Download JSON">
                      <LuDownload size={14} />
                      Download JSON
                    </Dropdown.Item>
                    <Dropdown.Item id="copy-tsv" textValue="Copy this page">
                      <LuCopy size={14} />
                      Copy this page
                    </Dropdown.Item>
                    <Dropdown.Item id="copy-csv" textValue="Copy this page as CSV">
                      <LuCopy size={14} />
                      Copy this page as CSV
                    </Dropdown.Item>
                    <Dropdown.Item id="copy-json" textValue="Copy this page as JSON">
                      <LuCopy size={14} />
                      Copy this page as JSON
                    </Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown.Popover>
              </Dropdown>
              <ColumnsPicker columns={all} hidden={hidden} onHiddenChange={hideColumns} />
            </>
          ) : (
            <>
              <Link
                className={buttonVariants({ variant: "ghost" })}
                to="/"
                search={{ focus: table.name }}
              >
                <LuGitCompare size={15} />
                Show in diagram
              </Link>
              <Link
                className={buttonVariants({ variant: "ghost" })}
                to="/schema"
                search={{ focus: table.name }}
              >
                <LuFileText size={15} />
                Drizzle schema
              </Link>
            </>
          )}
          <Tooltip>
            <Button
              variant={details ? "secondary" : "ghost"}
              isIconOnly
              className="ml-auto"
              aria-label="Toggle details"
              onPress={() => {
                setDetails((d) => !d);
              }}
            >
              <LuInfo />
            </Button>
            <Tooltip.Content>Toggle details</Tooltip.Content>
          </Tooltip>
        </header>
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-6 py-2">
          <Tabs
            selectedKey={activeTab}
            onSelectionChange={(key) => {
              void navigate({
                to: "/tables/$name",
                params: { name: table.name },
                search: { tab: key === "columns" ? "columns" : "data" },
              });
            }}
          >
            <Tabs.ListContainer className="w-fit">
              <Tabs.List aria-label={`${table.name} views`}>
                <Tabs.Tab id="data">Data</Tabs.Tab>
                <Tabs.Tab id="columns">Columns</Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
          </Tabs>
          {/* What the ticked rows can have done to them, next to the count of them. Nothing here
              is reachable any other way, so the strip only exists while a row is ticked. */}
          {chosen.length > 0 ? (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-ui text-muted">
                {chosen.length.toLocaleString()} {plural(chosen.length)} selected
              </span>
              <Button
                variant="outline"
                onPress={() => {
                  copyText(toTsv(columns, chosen), `${chosen.length} ${plural(chosen.length)}`);
                }}
              >
                <LuCopy size={15} />
                Copy
              </Button>
              <Button
                variant="danger"
                isDisabled={saving}
                onPress={() => {
                  setPending(chosen);
                }}
              >
                <LuTrash2 size={15} />
                Delete
              </Button>
              <Button
                variant="ghost"
                isIconOnly
                aria-label="Clear selection"
                onPress={clearSelection}
              >
                <LuX size={15} />
              </Button>
            </div>
          ) : null}
        </div>
        {activeTab === "data" ? (
          dataPane()
        ) : (
          <>
            {table.description ? (
              <p className="m-0 border-b border-line bg-surface-2 px-6 py-2.5 whitespace-pre-wrap text-muted">
                {table.description}
              </p>
            ) : null}
            <ColumnsTable table={table} query={query} highlight={column} />
          </>
        )}
      </div>
      {details ? <DetailsPanel table={table} /> : null}
      <ConfirmDialog
        isOpen={pending !== null}
        title={`Delete ${(pending ?? []).length} ${plural((pending ?? []).length)} from ${table.name}?`}
        detail={
          <>
            <p className="m-0">This writes to the database and cannot be undone.</p>
            <ul className="mt-2 mb-0 list-none space-y-1 p-0 font-mono text-code text-ink">
              {(pending ?? []).slice(0, 5).map((row) => (
                <li key={rowId(row, rowKey)}>{keyLabel(row, rowKey)}</li>
              ))}
              {(pending ?? []).length > 5 ? (
                <li className="text-muted">and {(pending ?? []).length - 5} more</li>
              ) : null}
            </ul>
          </>
        }
        confirmLabel={`Delete ${(pending ?? []).length} ${plural((pending ?? []).length)}`}
        isPending={remove.isPending}
        onConfirm={confirmDelete}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      />
    </section>
  );
}
