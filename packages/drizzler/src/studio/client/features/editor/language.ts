// The schema editor's language features: TypeScript's completions, hovers, signature help and
// type errors, asked of the project's own TypeScript through the API. The providers only turn
// the answers into Monaco's shapes. Without TypeScript (none installed, or 7.x) they answer
// nothing and the editor keeps its colouring and the parser's syntax errors.
import { parseResponse } from "hono/client";
import { editor, languages, MarkerSeverity, Range } from "monaco-editor/editor/editor.api.js";
import { languageClient } from "../../api/index.js";

// TypeScript's `ScriptElementKind` strings, as the language service labels its completions.
const KINDS: ReadonlyMap<string, keyof typeof languages.CompletionItemKind> = new Map([
  ["method", "Method"],
  ["function", "Function"],
  ["local function", "Function"],
  ["construct", "Constructor"],
  ["constructor", "Constructor"],
  ["property", "Property"],
  ["getter", "Property"],
  ["setter", "Property"],
  ["var", "Variable"],
  ["let", "Variable"],
  ["const", "Constant"],
  ["local var", "Variable"],
  ["parameter", "Variable"],
  ["alias", "Variable"],
  ["class", "Class"],
  ["local class", "Class"],
  ["interface", "Interface"],
  ["type", "Struct"],
  ["primitive type", "Struct"],
  ["type parameter", "TypeParameter"],
  ["enum", "Enum"],
  ["enum member", "EnumMember"],
  ["module", "Module"],
  ["external module name", "Module"],
  ["keyword", "Keyword"],
  ["string", "Text"],
  ["directory", "Folder"],
  ["script", "File"],
]);

/** The Monaco completion kind for a TypeScript completion kind name. */
export function completionKindOf(kind: string) {
  return languages.CompletionItemKind[KINDS.get(kind) ?? "Text"];
}

// Which of the two switches are on: the providers registered, and the API's TypeScript loaded.
const state = new Set<"enabled" | "registered">();

/** Turned on once the API says the project's TypeScript loaded. */
export function setLanguageEnabled(enabled: boolean) {
  if (enabled) state.add("enabled");
  else state.delete("enabled");
}

/** The model paths of the two TypeScript editors, and what the API calls them. */
export const SCHEMA_MODEL = "schema.ts";
export const QUERY_MODEL = "query.ts";

/** Which document a model is to the API; null for one the providers do not answer (SQL). */
function documentOf(model: editor.ITextModel) {
  if (!state.has("enabled") || model.getLanguageId() !== "typescript") return null;
  return model.uri.path.endsWith(QUERY_MODEL) ? ("query" as const) : ("schema" as const);
}

function rangeOf(model: editor.ITextModel, span: { readonly start: number; readonly end: number }) {
  const start = model.getPositionAt(span.start);
  const end = model.getPositionAt(span.end);
  return new Range(start.lineNumber, start.column, end.lineNumber, end.column);
}

// What each completion item was asked about, for its detail when it is highlighted.
const asked = new WeakMap<
  languages.CompletionItem,
  { readonly source: string; readonly offset: number; readonly document: "schema" | "query" }
>();

function completionProvider(): languages.CompletionItemProvider {
  return {
    triggerCharacters: [".", '"', "'", "/", "@", "<", "{", ","],
    async provideCompletionItems(model, position) {
      const document = documentOf(model);
      if (document === null) return null;
      const source = model.getValue();
      const offset = model.getOffsetAt(position);
      // A request the API refuses leaves the editor without the feature, not with an error.
      const found = await parseResponse(
        languageClient.language.complete.$post({ json: { source, offset, document } }),
      ).catch(() => null);
      if (found === null || model.getValue() !== source) return null;
      const word = model.getWordUntilPosition(position);
      const atWord = new Range(
        position.lineNumber,
        word.startColumn,
        position.lineNumber,
        word.endColumn,
      );
      const suggestions = found.items.map((item) => {
        const suggestion: languages.CompletionItem = {
          label: item.label,
          kind: completionKindOf(item.kind),
          insertText: item.insertText ?? item.label,
          sortText: item.sortText,
          range: item.replacement === null ? atWord : rangeOf(model, item.replacement),
        };
        asked.set(suggestion, { source, offset, document });
        return suggestion;
      });
      return { suggestions };
    },
    async resolveCompletionItem(item) {
      const context = asked.get(item);
      if (context === undefined) return item;
      const name = typeof item.label === "string" ? item.label : item.label.label;
      const detail = await parseResponse(
        languageClient.language.complete.detail.$post({ json: { ...context, name } }),
      ).catch(() => null);
      if (detail === null) return item;
      return {
        ...item,
        detail: detail.detail ?? undefined,
        documentation: detail.documentation === null ? undefined : { value: detail.documentation },
      };
    },
  };
}

function hoverProvider(): languages.HoverProvider {
  return {
    async provideHover(model, position) {
      const document = documentOf(model);
      if (document === null) return null;
      const source = model.getValue();
      const found = await parseResponse(
        languageClient.language.hover.$post({
          json: { source, offset: model.getOffsetAt(position), document },
        }),
      ).catch(() => null);
      if (found === null || found.contents === null || model.getValue() !== source) return null;
      return {
        contents: [{ value: found.contents }],
        range: found.range === null ? undefined : rangeOf(model, found.range),
      };
    },
  };
}

function signatureProvider(): languages.SignatureHelpProvider {
  return {
    signatureHelpTriggerCharacters: ["(", ","],
    signatureHelpRetriggerCharacters: [")"],
    async provideSignatureHelp(model, position) {
      const document = documentOf(model);
      if (document === null) return null;
      const found = await parseResponse(
        languageClient.language.signature.$post({
          json: { source: model.getValue(), offset: model.getOffsetAt(position), document },
        }),
      ).catch(() => null);
      if (found === null || found.signatures.length === 0) return null;
      return {
        value: {
          signatures: found.signatures.map((signature) => ({
            label: signature.label,
            documentation: signature.documentation ?? undefined,
            parameters: signature.parameters.map((parameter) => ({
              label: parameter.label,
              documentation: parameter.documentation ?? undefined,
            })),
          })),
          activeSignature: found.activeSignature,
          activeParameter: found.activeParameter,
        },
        dispose: () => undefined,
      };
    },
  };
}

/** Registers the providers once; they stay quiet until `setLanguageEnabled(true)`. */
export function registerLanguage() {
  if (state.has("registered")) return;
  state.add("registered");
  languages.registerCompletionItemProvider("typescript", completionProvider());
  languages.registerHoverProvider("typescript", hoverProvider());
  languages.registerSignatureHelpProvider("typescript", signatureProvider());
}

const MARKER_OWNER = "typescript";

const SEVERITY = {
  error: MarkerSeverity.Error,
  warning: MarkerSeverity.Warning,
  info: MarkerSeverity.Info,
} as const;

/** TypeScript's type errors under squiggles; the parser's syntax errors have their own owner. */
export function setTypeMarkers(
  model: editor.ITextModel,
  diagnostics: readonly {
    readonly message: string;
    readonly severity: "error" | "warning" | "info";
    readonly range: { readonly start: number; readonly end: number };
  }[],
) {
  editor.setModelMarkers(
    model,
    MARKER_OWNER,
    diagnostics.map((diagnostic) => {
      const range = rangeOf(model, diagnostic.range);
      return {
        severity: SEVERITY[diagnostic.severity],
        message: diagnostic.message,
        source: "ts",
        startLineNumber: range.startLineNumber,
        startColumn: range.startColumn,
        endLineNumber: range.endLineNumber,
        endColumn: Math.max(range.endColumn, range.startColumn + 1),
      };
    }),
  );
}
