import { Button, Kbd, Tabs } from "@heroui/react";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { LuPlay } from "react-icons/lu";

import { DiagnosticsList } from "../../components/diagnostics-list.js";
import { fieldTypeLabel } from "../diagram/labels.js";
import { ResultTable } from "../../components/result-table.js";
import { SplitPane } from "../../components/split-pane.js";
import { useDebounced } from "../../lib/debounce.js";
import { getDbKey, useDb, usePostDbExplain, usePostDbSql } from "../../hooks/index.js";
import { SchemaCanvas } from "../diagram/canvas.js";
import { useSavedDiagram } from "../diagram/saved-diagram.js";
import { useAnalysis } from "./analysis.js";
import { ColumnsView } from "./columns-view.js";
import { FlowView } from "./flow-view.js";
import { ParamsPanel } from "./params-panel.js";
import { bindValues, paramInputsOf } from "./params.js";
import { PlanView } from "./plan-view.js";
import { SqlEditor } from "./sql-editor.js";
import { TypeView } from "./type-view.js";

// How the page is shared out: the editor beside the schema, and the editor above the views.
const PANES_KEY = "drizzler-studio:sql-panes";
const EDITOR_KEY = "drizzler-studio:sql-editor-height";
const ANALYZE_DEBOUNCE_MS = 250;

type Tab = "flow" | "columns" | "type" | "result" | "plan";

// The server sends only the first page of a large result, so the count of what matched and the
// number of rows on screen can differ; say so rather than showing a wrong total.
function rowSummary(shown: number, matched: number) {
  const rows = `${matched.toLocaleString()} ${matched === 1 ? "row" : "rows"}`;
  return shown < matched ? `first ${shown.toLocaleString()} of ${rows}` : rows;
}

function problemDetail(error: unknown) {
  if (error instanceof Error) return error.message;
  return "The statement could not be run.";
}

function statementLabel(
  statement: { readonly text: string; readonly kind: string },
  index: number,
) {
  const first = statement.text.trim().split("\n")[0]?.trim() ?? "";
  const short = first.length > 28 ? `${first.slice(0, 27)}…` : first;
  return `${index + 1} · ${short === "" ? statement.kind : short}`;
}

/** The tables a statement touches and the columns it reads from each, keyed by lowercased table name. */
function highlightOf(
  statement: {
    readonly tables: readonly { readonly name: string; readonly columnsUsed: readonly string[] }[];
  } | null,
) {
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
function canvasHighlight(
  byName: ReadonlyMap<string, ReadonlySet<string>> | null,
  schema: {
    readonly models: readonly {
      readonly name: string;
      readonly dbName: string | null;
      readonly fields: readonly { readonly name: string; readonly dbName?: string | null }[];
    }[];
  } | null,
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

function tabOf(key: string | number): Tab {
  const name = String(key);
  return name === "columns" || name === "type" || name === "result" || name === "plan"
    ? name
    : "flow";
}

/** The SQL page: the editor and what the analysis says on the left, the tables it runs against on the right. */
export function SqlView({
  initialSql,
  initialParams,
}: {
  readonly initialSql: string;
  readonly initialParams: readonly (string | number | boolean | null)[];
}) {
  const queryClient = useQueryClient();
  const database = useDb().data ?? null;
  const { snapshot, schema } = useSavedDiagram();
  // The editor is empty on every visit, unless a page hands a statement over (the Query
  // page opens what the client sent, with the values it was bound with).
  const [sql, setSql] = useState(initialSql);
  const [tab, setTab] = useState<Tab>("flow");
  const [statementIndex, setStatementIndex] = useState(0);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [pickedRange, setPickedRange] = useState<{
    readonly start: number;
    readonly end: number;
  } | null>(null);
  const [paramInputs, setParamInputs] = useState<Readonly<Record<string, string>>>(() =>
    paramInputsOf(initialParams),
  );

  const settled = useDebounced(sql, ANALYZE_DEBOUNCE_MS);
  const analysis = useAnalysis(settled);
  const statements = analysis.data?.statements ?? [];
  const statement =
    statements[Math.min(statementIndex, Math.max(0, statements.length - 1))] ?? null;
  const stale = settled !== sql;

  // The editor points at the picked node's clause, or at the diagnostic that was clicked.
  const highlight =
    selectedNode === null
      ? pickedRange
      : (statement?.nodes.find((candidate) => candidate.id === selectedNode)?.range ?? null);

  // Held steady while there is no statement, so the editor is not handed a new empty list (and
  // made to redraw its marks) on every keystroke.
  const diagnostics = useMemo(() => statement?.diagnostics ?? [], [statement]);

  const touched = useMemo(
    () => canvasHighlight(highlightOf(statement), schema),
    [statement, schema],
  );

  // The database knows tables by their names; the pages know them by their exports.
  const modelOf = useCallback(
    (table: string) => {
      const key = table.toLowerCase();
      return (
        schema?.models.find((model) => (model.dbName ?? model.name).toLowerCase() === key)?.name ??
        null
      );
    },
    [schema],
  );

  const run = usePostDbSql({
    mutation: {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getDbKey() }),
    },
  });
  const explain = usePostDbExplain();
  const result = run.data ?? null;

  const params = useMemo(
    () => (statement === null ? [] : bindValues(statement.parameters, paramInputs)),
    [statement, paramInputs],
  );

  const execute = useCallback(() => {
    if (run.isPending || sql.trim() === "" || database?.connected !== true) return;
    const text = statement === null || statements.length <= 1 ? sql : statement.text;
    run.mutate({ json: { sql: text, params: [...params] } });
    setTab("result");
  }, [run, sql, database, statement, statements.length, params]);

  const runExplain = useCallback(() => {
    if (explain.isPending || sql.trim() === "" || database?.connected !== true) return;
    const text = statement === null || statements.length <= 1 ? sql : statement.text;
    explain.mutate({ json: { sql: text, params: [...params] } });
  }, [explain, sql, database, statement, statements.length, params]);

  const onChange = useCallback((value: string) => {
    setSql(value);
  }, []);

  // Completion and hovers offer the names the database knows — the table and column names over
  // the exports and properties — with the column type beside each one.
  const tables = useMemo(
    () =>
      (schema?.models ?? []).map((model) => ({
        name: model.dbName ?? model.name,
        detail: `table ${model.name}`,
        columns: model.fields.map((field) => ({
          name: field.dbName ?? field.name,
          detail: fieldTypeLabel(field),
        })),
      })),
    [schema],
  );

  function analysisStatus() {
    if (analysis.isError) return "The analysis failed.";
    if (stale || analysis.isFetching) return "Analyzing…";
    if (statement === null) return "";
    return `${statement.kind} · ${statement.nodes.length} nodes`;
  }

  function resultPane() {
    if (run.isError) return <div className="error-box m-4">{problemDetail(run.error)}</div>;
    if (result === null) {
      return <div className="p-6 text-muted">Run the statement to see its rows here.</div>;
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="border-b border-line bg-surface-2 px-4 py-1.5 text-code text-muted">
          {result.columns.length > 0
            ? rowSummary(result.rows.length, result.rowCount)
            : `${result.rowCount} ${result.rowCount === 1 ? "row" : "rows"} affected`}{" "}
          · {result.durationMs} ms
        </div>
        {result.columns.length > 0 ? (
          <ResultTable columns={result.columns} rows={result.rows} />
        ) : null}
      </div>
    );
  }

  function schemaCanvas() {
    if (schema === null) return null;
    if (schema.models.length === 0) {
      return <div className="p-6 text-muted">No tables in the schema.</div>;
    }
    return (
      <SchemaCanvas schema={schema} schemaPath={snapshot?.file ?? ""} touched={touched} compact />
    );
  }

  const editorPane = (
    <div className="flex min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <SqlEditor
          value={sql}
          onChange={onChange}
          onRun={execute}
          dialect={database?.dialect ?? null}
          tables={tables}
          highlight={highlight}
          diagnostics={diagnostics}
        />
      </div>
      <ParamsPanel
        parameters={statement?.parameters ?? []}
        inputs={paramInputs}
        onChange={(key, value) => {
          setParamInputs((current) => ({ ...current, [key]: value }));
        }}
      />
      <DiagnosticsList
        diagnostics={diagnostics}
        onPick={(range) => {
          setSelectedNode(null);
          setPickedRange(range);
        }}
      />
    </div>
  );

  const viewsPane = (
    <div className="flex min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-1.5">
        <Tabs
          selectedKey={tab}
          onSelectionChange={(key) => {
            setTab(tabOf(key));
          }}
        >
          <Tabs.ListContainer className="w-fit">
            <Tabs.List aria-label="Views of the statement">
              <Tabs.Tab id="flow">Flow</Tabs.Tab>
              <Tabs.Tab id="columns">Columns</Tabs.Tab>
              <Tabs.Tab id="type">Type</Tabs.Tab>
              <Tabs.Tab id="result">Result</Tabs.Tab>
              <Tabs.Tab id="plan">Plan</Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>
        {statements.length > 1 ? (
          <div className="flex flex-wrap items-center gap-1">
            {statements.map((entry, index) => (
              <button
                key={`${entry.range.start}-${entry.range.end}`}
                type="button"
                className={`pill ${index === statementIndex ? "border-accent bg-accent-soft text-accent-text" : "border-line bg-canvas text-muted hover:border-accent"}`}
                onClick={() => {
                  setStatementIndex(index);
                  setSelectedNode(null);
                }}
              >
                {statementLabel(entry, index)}
              </button>
            ))}
          </div>
        ) : null}
        <span className="ml-auto text-code text-faint">{analysisStatus()}</span>
      </div>
      {tab === "flow" ? (
        <FlowView
          nodes={statement?.nodes ?? []}
          edges={statement?.edges ?? []}
          selected={selectedNode}
          onSelect={setSelectedNode}
        />
      ) : null}
      {tab === "columns" && statement !== null ? (
        <ColumnsView statement={statement} modelOf={modelOf} />
      ) : null}
      {tab === "type" && statement !== null ? <TypeView statement={statement} /> : null}
      {tab === "result" ? resultPane() : null}
      {tab === "plan" ? (
        <PlanView
          plan={explain.data ?? null}
          pending={explain.isPending}
          error={explain.isError ? problemDetail(explain.error) : null}
          onExplain={runExplain}
        />
      ) : null}
    </div>
  );

  const workspace = (
    <div className="flex min-h-0 min-w-0 flex-col">
      <header className="flex flex-wrap items-center gap-3.5 border-b border-line bg-surface px-6 py-3">
        <h1 className="page-title">SQL</h1>
        <span className="min-w-0 text-lead [overflow-wrap:anywhere] text-muted">
          {database?.connected
            ? `${database.dialect ?? ""} · ${database.url ?? ""}`
            : "No database connected"}
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-code text-faint">
          <Kbd>⌘/Ctrl</Kbd>
          <Kbd>Enter</Kbd>
          to run
        </span>
        <Button
          variant="primary"
          isDisabled={run.isPending || database?.connected !== true}
          onPress={execute}
        >
          <LuPlay size={14} />
          Run
        </Button>
      </header>
      {database !== null && !database.connected ? (
        <div className="error-box m-4">
          {database.error ?? "Start Studio with --url <connection string> or set DATABASE_URL."}
        </div>
      ) : null}
      <SplitPane
        direction="column"
        storageKey={EDITOR_KEY}
        defaultRatio={0.4}
        label="Resize the editor"
        first={editorPane}
        second={viewsPane}
      />
    </div>
  );

  const schemaPane = (
    <div className="flex min-h-0 min-w-0 flex-col">
      <div className="flex items-center gap-3 border-b border-line bg-surface px-4 py-2 text-code text-muted">
        <span className="heading mb-0">Schema</span>
        <span className="truncate">
          {touched === null
            ? "Every table; the ones a statement touches light up as you type."
            : `${touched.size} ${touched.size === 1 ? "table" : "tables"} touched · the columns read are marked`}
        </span>
      </div>
      {schemaCanvas()}
    </div>
  );

  return (
    <section className="flex min-h-0 flex-1 overflow-hidden">
      <SplitPane
        direction="row"
        storageKey={PANES_KEY}
        defaultRatio={0.58}
        min={0.3}
        max={0.8}
        label="Resize the schema"
        first={workspace}
        second={schemaPane}
      />
    </section>
  );
}
