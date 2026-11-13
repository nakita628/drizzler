import { Button, Kbd, toast, Tooltip } from "@heroui/react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import type { editor as MonacoEditor } from "monaco-editor/editor/editor.api.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { LuCopy, LuPlay, LuWandSparkles } from "react-icons/lu";
import { ConfirmDialog } from "../../components/confirm-dialog.js";
import { SplitPane } from "../../components/split-pane.js";
import {
  getDbKey,
  useDb,
  useLanguage,
  usePostDrizzle,
  usePostFormat,
  usePostLanguageDiagnostics,
} from "../../hooks/index.js";
import { copyText } from "../../lib/copy.js";
import { problemMessage } from "../../lib/problem.js";
import { loadString, saveString } from "../../lib/storage.js";
import { useSavedDiagram } from "../diagram/saved-diagram.js";
import { CodeEditor } from "../editor/code-editor.js";
import { QUERY_MODEL, setLanguageEnabled, setTypeMarkers } from "../editor/language.js";
import { bindFormatter } from "../editor/monaco.js";
import { ResultPane } from "./result-pane.js";
import { QuerySchemaPane } from "./schema-pane.js";
import { useTouched } from "./touched.js";
import type { TouchedTable } from "./touched.js";

const CODE_KEY = "drizzler-studio:query";
const CHECK_DEBOUNCE_MS = 500;
// How the page is shared out: the editor above its result and SQL, and the schema the whole
// height of the other side, to be looked at while the query is written.
const PANES_KEY = "drizzler-studio:query-panes";
const EDITOR_KEY = "drizzler-studio:query-editor-height";

/** Puts code in the Query page's editor, for the page to open with: the docs' examples go there. */
export function presetQuery(code: string) {
  saveString(CODE_KEY, `${code}\n`);
}

// What earlier studios put in the editor for a start; a browser that kept it opens empty instead.
const FORMER_STARTER = "// `db` is Drizzle over the connected database";

function initialCode() {
  const stored = loadString(CODE_KEY) ?? "";
  return stored.startsWith(FORMER_STARTER) ? "" : stored;
}

// A bound value as the SQL page takes it: a scalar as it is, anything else as JSON.
function sqlParam(value: unknown) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return JSON.stringify(value);
}

// Why a query cannot run: no database, or the project's TypeScript did not load (`missing` is
// the language status when it did not); null when it can.
function whyUnavailable(connected: boolean, missing: { readonly reason: string | null } | null) {
  if (!connected) return "Start the studio with --url (or set DATABASE_URL) to run queries.";
  if (missing !== null) return `Running a query needs the project's TypeScript: ${missing.reason}`;
  return null;
}

/**
 * Drizzle against the connected database: a query typed as the application would write it, with
 * completion and type errors from the project's TypeScript, run through the project's own
 * drizzle-orm, its result beside the tables it touches and the SQL it sends.
 */
export function QueryView() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const db = useDb().data ?? null;
  const language = useLanguage().data ?? null;
  const typesOn = (language?.typescript ?? null) !== null;
  const { snapshot, schema } = useSavedDiagram();
  const run = usePostDrizzle();
  const check = usePostLanguageDiagnostics();
  const format = usePostFormat();
  const [code, setCode] = useState<string | null>(null);
  const [tab, setTab] = useState<"result" | "sql">("result");
  const [asJson, setAsJson] = useState(false);
  const [writes, setWrites] = useState<readonly TouchedTable[] | null>(null);
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const checkSeq = useRef(0);
  const text = code ?? (db === null ? null : initialCode());
  const { tables, analyze } = useTouched(text ?? "", snapshot?.source ?? null);

  useEffect(() => {
    setLanguageEnabled(typesOn);
  }, [typesOn]);

  // Format Document runs oxfmt on the server, as the schema editor's does.
  useEffect(() => {
    bindFormatter(async (source) => {
      try {
        return (await format.mutateAsync({ json: { source } })).source;
      } catch (error) {
        toast.danger(problemMessage(error));
        return null;
      }
    });
    return () => bindFormatter(null);
  }, [format]);

  // Type errors once typing stops, checked against the saved schema.
  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!typesOn || text === null || !model) return;
    const seq = ++checkSeq.current;
    const timer = setTimeout(() => {
      check.mutate(
        { json: { source: text, document: "query" } },
        {
          onSuccess(result) {
            if (seq === checkSeq.current && !model.isDisposed()) {
              setTypeMarkers(model, result.diagnostics);
            }
          },
        },
      );
    }, CHECK_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, typesOn, editorReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = useCallback(
    (current: string) => {
      run.mutate(
        { json: { code: current } },
        {
          onSuccess(result) {
            setTab(result.error !== null && result.statements.length > 0 ? "sql" : "result");
            // A write changes the counts and rows the other pages show.
            if (result.statements.some((s) => !/^\s*(select|with)\b/iu.test(s.sql))) {
              void queryClient.invalidateQueries({ queryKey: getDbKey() });
            }
          },
        },
      );
    },
    [run, queryClient],
  );

  // A write is confirmed first; the code is read again on the spot so a just-typed `delete` is
  // not waved through on the strength of an analysis from before it was typed.
  const execute = useCallback(async () => {
    const current = editorRef.current?.getValue() ?? text;
    if (current === null || current.trim() === "" || run.isPending) return;
    const checked = await analyze.mutateAsync({ json: { code: current } }).catch(() => null);
    const writing = checked?.tables.filter((t) => t.write) ?? [];
    if (writing.length > 0) {
      setWrites(writing);
      return;
    }
    send(current);
  }, [text, run.isPending, analyze, send]);

  if (db === null || text === null) return <div className="p-6 text-muted">Loading…</div>;
  const result = run.data ?? null;
  const unavailable = whyUnavailable(db.connected, typesOn ? null : language);

  const editorPane = (
    <div className="flex min-h-0 flex-col">
      <div className="min-h-0 flex-1 bg-surface">
        <CodeEditor
          path={QUERY_MODEL}
          language="typescript"
          value={text}
          commands={[{ keys: "run", run: () => void execute() }]}
          onChange={(next) => {
            setCode(next);
            saveString(CODE_KEY, next);
          }}
          onMount={(editor) => {
            editorRef.current = editor;
            setEditorReady(true);
            // The model outlives the page; code put in while it was away replaces what it held.
            if (editor.getValue() !== text) editor.setValue(text);
          }}
        />
      </div>
      {tables.length === 0 ? null : (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-line bg-surface-2 px-4 py-1.5 text-code">
          <span className="heading mb-0">Tables</span>
          {tables.map((table) => (
            <span
              key={table.table}
              className={`pill ${table.write ? "border-warn text-warn" : "border-line bg-canvas text-muted"}`}
            >
              {table.table}
              {table.write ? " · write" : ""}
            </span>
          ))}
        </div>
      )}
    </div>
  );

  const resultPane = (
    <ResultPane
      tab={tab}
      onTab={setTab}
      result={result}
      running={run.isPending}
      error={run.isError ? run.error : null}
      asJson={asJson}
      onAsJson={setAsJson}
      dialect={db.dialect}
      // The SQL page opens the statement as it was sent, with the values it was bound with.
      onOpen={(statement) => {
        void navigate({
          to: "/sql",
          search: {
            sql: statement.sql,
            params: statement.params.map(sqlParam),
          },
        });
      }}
    />
  );

  const workspace = (
    <div className="flex min-h-0 min-w-0 flex-col">
      <header className="flex flex-wrap items-center gap-3.5 border-b border-line bg-surface px-6 py-3">
        <h1 className="page-title">Query</h1>
        <span className="min-w-0 text-lead [overflow-wrap:anywhere] text-muted">
          {text.split("\n").length} lines
          {db.connected ? ` · Drizzle · ${db.dialect} ${db.url}` : " · No database connected"}
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-code text-faint">
          <Kbd>⌘/Ctrl</Kbd>
          <Kbd>Enter</Kbd>
          to run
        </span>
        <Tooltip>
          <Button
            variant="ghost"
            onPress={() => {
              void editorRef.current?.getAction("editor.action.formatDocument")?.run();
            }}
          >
            <LuWandSparkles size={15} />
            Format
          </Button>
          <Tooltip.Content>Format with oxfmt (Shift+Alt+F)</Tooltip.Content>
        </Tooltip>
        <Button
          variant="ghost"
          onPress={() => {
            copyText(editorRef.current?.getValue() ?? text, "The query");
          }}
        >
          <LuCopy size={15} />
          Copy
        </Button>
        <Button
          variant="primary"
          isDisabled={unavailable !== null || run.isPending}
          onPress={() => void execute()}
        >
          <LuPlay size={14} />
          Run
        </Button>
      </header>
      {unavailable ? <pre className="error-box m-4 whitespace-pre-wrap">{unavailable}</pre> : null}
      <SplitPane
        direction="column"
        storageKey={EDITOR_KEY}
        defaultRatio={0.4}
        label="Resize the editor"
        first={editorPane}
        second={resultPane}
      />
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
        second={
          <QuerySchemaPane
            schema={schema}
            schemaPath={snapshot?.file ?? null}
            parseError={(snapshot?.parseError ?? null) !== null}
            tables={tables}
          />
        }
      />
      <ConfirmDialog
        isOpen={writes !== null}
        title={`Run a write to ${writes?.length === 1 ? "a table" : `${writes?.length ?? 0} tables`}?`}
        detail={
          <div className="flex flex-col gap-2">
            <span>This changes the database through Drizzle:</span>
            <ul className="m-0 list-disc pl-5 font-mono text-code">
              {(writes ?? []).map((table) => (
                <li key={table.table}>{table.table}</li>
              ))}
            </ul>
          </div>
        }
        confirmLabel="Run"
        isPending={run.isPending}
        onConfirm={() => {
          setWrites(null);
          send(editorRef.current?.getValue() ?? text);
        }}
        onOpenChange={(open) => {
          if (!open) setWrites(null);
        }}
      />
    </section>
  );
}
