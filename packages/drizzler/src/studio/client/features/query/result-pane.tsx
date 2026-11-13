import { Tabs } from "@heroui/react";
import { useMemo } from "react";
import { CodeBlock } from "../../components/code-block.js";
import { ModeSwitch } from "../../components/mode-switch.js";
import { ResultTable } from "../../components/result-table.js";
import { problemMessage } from "../../lib/problem.js";
import { asRows } from "./result-view.js";
import { Statements } from "./statements.js";

type Statement = {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly rowCount: number;
  readonly durationMs: number;
};

type Result = {
  readonly result: unknown;
  readonly error: string | null;
  readonly statements: readonly Statement[];
  readonly durationMs: number;
};

/**
 * Under the editor, one tab at a time: what the query came back with, as a table or as JSON (and,
 * when it threw, the message with the statements that ran before it), or the SQL it sent.
 */
export function ResultPane({
  tab,
  onTab,
  result,
  running,
  error,
  asJson,
  onAsJson,
  dialect,
  onOpen,
}: {
  readonly tab: "result" | "sql";
  readonly onTab: (tab: "result" | "sql") => void;
  readonly result: Result | null;
  /** Whether a run is on its way. */
  readonly running: boolean;
  /** What the request failed with, when it did. */
  readonly error: unknown;
  readonly asJson: boolean;
  readonly onAsJson: (asJson: boolean) => void;
  readonly dialect: "postgresql" | "mysql" | "sqlite" | null;
  readonly onOpen: (statement: Statement) => void;
}) {
  const table = useMemo(
    () => (result === null || result.error !== null ? null : asRows(result.result)),
    [result],
  );
  const count = result?.statements.length ?? 0;
  const statements = `${count} ${count === 1 ? "statement" : "statements"}`;
  const rows =
    table === null
      ? "one value"
      : `${table.rows.length.toLocaleString()} ${table.rows.length === 1 ? "row" : "rows"}`;
  function runStatus() {
    if (running) return "Running…";
    if (result === null) return "";
    if (tab === "result" && result.error === null) {
      return `${rows} · ${result.durationMs} ms · ${statements}`;
    }
    return `${statements} · ${result.durationMs} ms`;
  }

  function body() {
    if (error !== null && error !== undefined) {
      return <pre className="error-box m-4 whitespace-pre-wrap">{problemMessage(error)}</pre>;
    }
    if (result === null) {
      return <div className="p-6 text-muted">Run the query to see what it returns.</div>;
    }
    if (tab === "sql") {
      return <Statements statements={result.statements} dialect={dialect} onOpen={onOpen} />;
    }
    if (result.error !== null) {
      return (
        <div className="flex min-h-0 flex-1 flex-col overflow-auto">
          <pre className="error-box m-4 whitespace-pre-wrap">{result.error}</pre>
          {count > 0 ? (
            <p className="m-0 px-4 text-code text-muted">
              {statements} ran before it; they are on the SQL tab.
            </p>
          ) : null}
        </div>
      );
    }
    if (table !== null && !asJson) {
      return <ResultTable columns={table.columns} rows={table.rows} />;
    }
    return (
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <CodeBlock code={JSON.stringify(result.result, null, 2) ?? "undefined"} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-1.5 text-code">
        <Tabs
          selectedKey={tab}
          onSelectionChange={(key) => {
            onTab(key === "sql" ? "sql" : "result");
          }}
        >
          <Tabs.ListContainer className="w-fit">
            <Tabs.List aria-label="Views of the query">
              <Tabs.Tab id="result">Result</Tabs.Tab>
              <Tabs.Tab id="sql" className="whitespace-nowrap">
                SQL{result === null ? "" : ` · ${count}`}
              </Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>
        </Tabs>
        {tab === "result" && table !== null ? (
          <ModeSwitch
            modes={["Table", "JSON"]}
            selected={asJson ? "JSON" : "Table"}
            onSelect={(mode) => {
              onAsJson(mode === "JSON");
            }}
          />
        ) : null}
        <output aria-label="Run status" className="ml-auto text-faint">
          {runStatus()}
        </output>
      </div>
      {body()}
    </div>
  );
}
