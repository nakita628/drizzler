import { Editor } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor/editor/editor.api.js";
import { useEffect, useRef } from "react";
import { useUiStore } from "../../lib/store.js";
import { BASE_OPTIONS, setupMonaco, themeName } from "./monaco.js";

/** Keys a view binds on its editor: Ctrl/Cmd+S, Ctrl/Cmd+Enter, ... */
export type EditorCommand = {
  readonly keys: "save" | "run";
  readonly run: () => void;
};

/**
 * A Monaco editor in the studio's theme. `path` names its model, so two editors (the schema,
 * the SQL console) never share an undo history.
 */
// One empty list for every editor without commands, so the prop does not change each render.
const NO_COMMANDS: readonly EditorCommand[] = [] as const;

/** A Monaco editor in the studio's theme, with keyboard commands bound once on mount. */
export function CodeEditor({
  path,
  language,
  value,
  commands = NO_COMMANDS,
  onChange,
  onMount,
}: {
  readonly path: string;
  readonly language: "typescript" | "sql";
  readonly value: string;
  readonly commands?: readonly EditorCommand[];
  readonly onChange: (text: string) => void;
  readonly onMount?: (editor: MonacoEditor.IStandaloneCodeEditor) => void;
}) {
  const monaco = setupMonaco();
  const theme = useUiStore((s) => s.theme);
  // The commands are bound once on mount; they call through this, so they run the latest closures.
  const latest = useRef(commands);
  useEffect(() => {
    latest.current = commands;
  });

  return (
    <Editor
      path={path}
      language={language}
      value={value}
      theme={themeName(theme)}
      options={BASE_OPTIONS}
      keepCurrentModel
      loading={<div className="p-4 text-code text-muted">Loading editor…</div>}
      onMount={(editor) => {
        function bind(keys: EditorCommand["keys"], keybinding: number) {
          return editor.addCommand(keybinding, () =>
            latest.current.find((c) => c.keys === keys)?.run(),
          );
        }
        bind("save", monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS);
        bind("run", monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter);
        // Monaco binds Ctrl+Shift+I on Linux; Shift+Alt+F formats everywhere.
        editor.addCommand(monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF, () => {
          void editor.getAction("editor.action.formatDocument")?.run();
        });
        onMount?.(editor);
      }}
      onChange={(text) => {
        if (text !== undefined) onChange(text);
      }}
    />
  );
}
