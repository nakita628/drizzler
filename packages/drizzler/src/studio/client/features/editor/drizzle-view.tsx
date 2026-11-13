import { Button, Chip, Tooltip, toast } from "@heroui/react";
import { useQueryClient } from "@tanstack/react-query";
import type { editor as MonacoEditor } from "monaco-editor/editor/editor.api.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LuSave, LuSparkles } from "react-icons/lu";
import { SplitPane } from "../../components/split-pane.js";
import {
  getSchemaQueryKey,
  useLanguage,
  usePostDiagramSchema,
  usePostFormat,
  usePostLanguageDiagnostics,
  usePutSchema,
  useSchema,
} from "../../hooks/index.js";
import { problemMessage } from "../../lib/problem.js";
import { CodeEditor } from "./code-editor.js";
import { SCHEMA_MODEL, setLanguageEnabled, setTypeMarkers } from "./language.js";
import { bindFormatter, setParseMarker } from "./monaco.js";
import { SchemaCanvas } from "../diagram/canvas.js";
import type { CanvasSchema } from "../diagram/types.js";

type ParseError = { readonly message: string; readonly line: number; readonly column: number };

const DRAW_DEBOUNCE_MS = 250;
const CHECK_DEBOUNCE_MS = 500;

/**
 * The schema file in Monaco on the left and its ER diagram on the right, redrawn as you type;
 * the card of the table the cursor is in is selected. A link can name a table (`focus`) or a
 * line to open on, as the diagram, the table pages and the error banner hand them over.
 * The editor holds the text; `base` is the text on disk as far as the page knows. A change on
 * disk replaces a clean editor and waits behind a banner when there is unsaved work.
 */
// What the header chip says of the file: a syntax error first, then the save in flight, then
// whether the text differs from the file.
function saveStatus(input: {
  readonly parseError: ParseError | null;
  readonly saving: boolean;
  readonly dirty: boolean;
}) {
  if (input.parseError) {
    return { label: `Line ${input.parseError.line}: syntax error`, color: "danger" } as const;
  }
  if (input.saving) return { label: "Saving…", color: "warning" } as const;
  if (input.dirty) return { label: "Unsaved", color: "warning" } as const;
  return { label: "Saved", color: "success" } as const;
}

/** The Drizzle schema page: the file in Monaco beside its live ER diagram. */
export function DrizzleView({
  focus,
  line,
}: {
  readonly focus: string | null;
  readonly line: number | null;
}) {
  const queryClient = useQueryClient();
  const snapshot = useSchema().data ?? null;
  const draw = usePostDiagramSchema();
  const format = usePostFormat();
  const put = usePutSchema();
  const language = useLanguage().data ?? null;
  const check = usePostLanguageDiagnostics();
  const typesOn = (language?.typescript ?? null) !== null;

  const [text, setText] = useState<string | null>(null);
  const [base, setBase] = useState<string | null>(null);
  const [onDisk, setOnDisk] = useState<string | null>(null);
  const [diagram, setDiagram] = useState<CanvasSchema | null>(null);
  const [cursorLine, setCursorLine] = useState(1);
  const [parseError, setParseError] = useState<ParseError | null>(null);
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  // The editor mounts after the text arrives; the type check waits for it.
  const [editorReady, setEditorReady] = useState(false);
  const drawSeq = useRef(0);
  const saving = useRef(false);

  const dirty = text !== null && base !== null && text !== base;

  // The file on disk: taken when the editor is clean, held back when it is not.
  useEffect(() => {
    if (snapshot === null) return;
    if (base === null || text === null) {
      setText(snapshot.source);
      setBase(snapshot.source);
      return;
    }
    if (snapshot.source === base) return;
    if (text === base || text === snapshot.source) {
      setText(snapshot.source);
      setBase(snapshot.source);
      setOnDisk(null);
    } else {
      setOnDisk(snapshot.source);
    }
  }, [snapshot?.source]); // eslint-disable-line react-hooks/exhaustive-deps

  // The drawing follows the editor, unsaved text included; a stale answer is dropped.
  useEffect(() => {
    if (text === null) return;
    const seq = ++drawSeq.current;
    const timer = setTimeout(() => {
      draw.mutate(
        { json: { source: text } },
        {
          onSuccess(result) {
            if (seq !== drawSeq.current) return;
            setParseError(result.parseError);
            if (result.schema !== null) setDiagram(result.schema);
          },
        },
      );
    }, DRAW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  // Where a link asked to open: the line of the table it named, or the line it gave. Taken once
  // the editor holds the text, and again whenever another one is asked for.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor === null || text === null) return;
    const target =
      focus !== null
        ? text
            .split("\n")
            .findIndex((row) => new RegExp(`^export const ${focus}\\b`, "u").test(row)) + 1
        : (line ?? 0);
    if (target < 1) return;
    editor.setPosition({ lineNumber: target, column: 1 });
    editor.revealLineInCenter(target);
    editor.focus();
  }, [focus, line, editorReady, text === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const highlight = useMemo(
    () =>
      diagram?.models.find((m) => m.lines.start <= cursorLine && cursorLine <= m.lines.end)?.name ??
      null,
    [diagram, cursorLine],
  );

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (model) setParseMarker(model, parseError);
  }, [parseError]);

  useEffect(() => {
    setLanguageEnabled(typesOn);
  }, [typesOn]);

  // Type errors once typing stops. While the text does not parse, the parser's error is the one
  // that matters, and TypeScript's would only repeat it.
  const checkSeq = useRef(0);
  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!typesOn || text === null || !model) return;
    if (parseError !== null) {
      setTypeMarkers(model, []);
      return;
    }
    const seq = ++checkSeq.current;
    const timer = setTimeout(() => {
      check.mutate(
        { json: { source: text } },
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
  }, [text, typesOn, parseError, editorReady]); // eslint-disable-line react-hooks/exhaustive-deps

  const runFormat = useCallback(
    async (source: string) => {
      try {
        return (await format.mutateAsync({ json: { source } })).source;
      } catch (error) {
        toast.danger(problemMessage(error));
        return null;
      }
    },
    [format],
  );

  useEffect(() => {
    bindFormatter(runFormat);
    return () => bindFormatter(null);
  }, [runFormat]);

  const formatDocument = useCallback(async () => {
    const editor = editorRef.current;
    await editor?.getAction("editor.action.formatDocument")?.run();
    // A button press takes the focus; give it back so typing (and Ctrl+S) go on in the editor.
    editor?.focus();
  }, []);

  const save = useCallback(async () => {
    const editor = editorRef.current;
    if (editor === null || saving.current) return;
    saving.current = true;
    try {
      const source = editor.getValue();
      const saved = await put.mutateAsync({ json: { source } });
      // The save is what the next change event will report; with it in the cache already, the
      // page does not mistake its own write for someone else's.
      queryClient.setQueryData(getSchemaQueryKey(), saved);
      setBase(saved.source);
      setOnDisk(null);
    } catch (error) {
      toast.danger(problemMessage(error));
    } finally {
      saving.current = false;
    }
  }, [put, queryClient]);

  // Ctrl/Cmd+S saves wherever the focus is; left to the browser it would save the page.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    }
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, [save]);

  useEffect(() => {
    if (!dirty) return;
    function warn(event: BeforeUnloadEvent) {
      return event.preventDefault();
    }
    globalThis.addEventListener("beforeunload", warn);
    return () => globalThis.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const status = saveStatus({ parseError, saving: put.isPending, dirty });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-nowrap items-center gap-3.5 border-b border-line bg-surface px-6 py-3">
        <h1 className="page-title shrink-0">Drizzle schema</h1>
        <span className="min-w-0 truncate font-mono text-lead text-muted">
          {snapshot?.file ?? "…"}
        </span>
        <Chip size="sm" color={status.color} variant="soft">
          {status.label}
        </Chip>
        {language === null ? null : (
          <Tooltip delay={300}>
            <Tooltip.Trigger>
              <Chip size="sm" variant="soft" color={typesOn ? "accent" : "default"}>
                {typesOn ? `TS ${language.typescript}` : "No TypeScript"}
              </Chip>
            </Tooltip.Trigger>
            <Tooltip.Content className="max-w-96 text-meta">
              {typesOn
                ? "Completion, hovers, signatures and type errors from the project's TypeScript."
                : language.reason}
            </Tooltip.Content>
          </Tooltip>
        )}
        <span className="ml-auto" />
        <Button
          size="sm"
          variant="ghost"
          onPress={() => void formatDocument()}
          isDisabled={text === null}
        >
          <LuSparkles />
          Format
        </Button>
        <Button size="sm" onPress={() => void save()} isDisabled={!dirty || put.isPending}>
          <LuSave />
          Save
        </Button>
      </header>
      {onDisk !== null ? (
        <div className="flex items-center gap-3 border-b border-danger-line bg-danger-soft px-4 py-2 text-body">
          <span className="flex-1">The file changed on disk while you have unsaved edits.</span>
          <Button
            size="sm"
            variant="ghost"
            onPress={() => {
              setText(onDisk);
              setBase(onDisk);
              setOnDisk(null);
            }}
          >
            Load the file
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onPress={() => {
              setBase(onDisk);
              setOnDisk(null);
            }}
          >
            Keep my edits
          </Button>
        </div>
      ) : null}
      <SplitPane
        direction="row"
        storageKey="drizzler-studio:schema-split"
        defaultRatio={0.42}
        label="Resize the editor"
        first={
          <div className="min-h-0 min-w-0 bg-surface">
            {text === null ? null : (
              <CodeEditor
                path={SCHEMA_MODEL}
                language="typescript"
                value={text}
                commands={[{ keys: "save", run: () => void save() }]}
                onChange={setText}
                onMount={(editor) => {
                  editorRef.current = editor;
                  setEditorReady(true);
                  editor.onDidChangeCursorPosition((event) =>
                    setCursorLine(event.position.lineNumber),
                  );
                  const model = editor.getModel();
                  if (model) setParseMarker(model, parseError);
                }}
              />
            )}
          </div>
        }
        second={
          <div className="relative flex h-full min-h-0 flex-col">
            {diagram === null || snapshot === null ? (
              <div className="diagram-canvas flex flex-1 items-center justify-center text-body text-muted">
                {parseError ? "Fix the syntax error to draw the diagram." : "Drawing…"}
              </div>
            ) : (
              <SchemaCanvas
                schema={diagram}
                schemaPath={snapshot.file}
                highlight={highlight}
                compact
              />
            )}
            {parseError ? (
              <button
                type="button"
                className="absolute right-3 bottom-3 left-3 z-10 rounded-lg border border-danger-line bg-danger-soft px-3 py-2 text-left font-mono text-code text-danger"
                onClick={() => {
                  const editor = editorRef.current;
                  if (editor === null) return;
                  editor.setPosition({ lineNumber: parseError.line, column: parseError.column });
                  editor.revealLineInCenter(parseError.line);
                  editor.focus();
                }}
              >
                Line {parseError.line}, column {parseError.column}: {parseError.message}
                <span className="ml-2 font-sans text-meta text-muted">
                  (the last drawing is kept)
                </span>
              </button>
            ) : null}
          </div>
        }
      />
    </div>
  );
}
