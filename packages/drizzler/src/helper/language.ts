// What the editor's TypeScript answers, shaped for the client: pure functions over what the
// language service returned. services/typescript.ts loads TypeScript, puts the text in place and
// asks; TypeScript's own display-part formatter is passed in as \`parts\`.

/** A span of the language service's file. */
type Span = { readonly start: number; readonly length: number };

/** Turns TypeScript's display parts into text (\`ts.displayPartsToString\`). */
type Parts = (parts: readonly unknown[] | undefined) => string;

/**
 * A span of the language service's file as one of the text the editor sent, which starts \`base\`
 * characters into the file and is \`length\` long; null outside it (in the query's preamble).
 */
export function localSpan(span: Span, base: number, length: number) {
  const start = span.start - base;
  const end = start + span.length;
  return start < 0 || end > length ? null : { start, end };
}

/**
 * The query file's text, the lines in front, the query and what closes it; \`base\` is where the
 * query starts in it, and \`position\` the editor's offset in the file, kept within the query.
 */
export function queryDocument(input: {
  readonly preamble: string;
  readonly suffix: string;
  readonly code: string;
  readonly offset: number;
}) {
  const { preamble, suffix, code, offset } = input;
  const base = preamble.length;
  return {
    text: `${preamble}${code}${suffix}`,
    base,
    position: base + Math.max(0, Math.min(offset, code.length)),
  };
}

/** The editor's offset in a text of its own (the schema), kept within the text. */
export function clampOffset(offset: number, length: number) {
  return Math.max(0, Math.min(offset, length));
}

/** How the editor marks a diagnostic of a category, given TypeScript's category numbers. */
export function severityOf(
  category: number,
  categories: { readonly error: number; readonly warning: number },
) {
  if (category === categories.error) return "error" as const;
  if (category === categories.warning) return "warning" as const;
  return "info" as const;
}

/**
 * The completions to offer: the preamble's own \`__\` names left out, and a replacement span read
 * as one of the editor's text.
 */
export function completionItems(
  entries: readonly {
    readonly name: string;
    readonly kind: string;
    readonly sortText: string;
    readonly insertText?: string;
    readonly replacementSpan?: Span;
  }[],
  base: number,
  length: number,
) {
  return entries
    .filter((entry) => !entry.name.startsWith("__"))
    .map((entry) => ({
      label: entry.name,
      kind: entry.kind,
      sortText: entry.sortText,
      insertText: entry.insertText ?? null,
      replacement: entry.replacementSpan ? localSpan(entry.replacementSpan, base, length) : null,
    }));
}

/** A hover's text: the signature as a TypeScript code block, then its documentation if any. */
export function hoverContents(signature: string, documentation: string) {
  return [
    `\`\`\`typescript\n${signature}\n\`\`\``,
    ...(documentation === "" ? [] : [documentation]),
  ].join("\n\n");
}

/** Signature help: each signature's label, built from its parts, with its parameters. */
export function signatureHelp(
  help:
    | {
        readonly items: readonly {
          readonly prefixDisplayParts: readonly unknown[];
          readonly separatorDisplayParts: readonly unknown[];
          readonly suffixDisplayParts: readonly unknown[];
          readonly documentation: readonly unknown[];
          readonly parameters: readonly {
            readonly displayParts: readonly unknown[];
            readonly documentation: readonly unknown[];
          }[];
        }[];
        readonly selectedItemIndex: number;
        readonly argumentIndex: number;
      }
    | undefined,
  parts: Parts,
) {
  if (help === undefined) return { signatures: [], activeSignature: 0, activeParameter: 0 };
  return {
    signatures: help.items.map((item) => {
      const parameters = item.parameters.map((parameter) => ({
        label: parts(parameter.displayParts),
        documentation: parts(parameter.documentation) || null,
      }));
      const separator = parts(item.separatorDisplayParts);
      return {
        label: `${parts(item.prefixDisplayParts)}${parameters.map((p) => p.label).join(separator)}${parts(item.suffixDisplayParts)}`,
        documentation: parts(item.documentation) || null,
        parameters,
      };
    }),
    activeSignature: help.selectedItemIndex,
    activeParameter: help.argumentIndex,
  };
}

/**
 * The type errors inside the editor's text, in order: each with its message, severity and range;
 * one without a position, or in the query's preamble, is left out.
 */
export function editorDiagnostics(
  found: readonly {
    readonly start: number | undefined;
    readonly length: number | undefined;
    readonly category: number;
    readonly message: string;
  }[],
  input: {
    readonly base: number;
    readonly length: number;
    readonly categories: { readonly error: number; readonly warning: number };
  },
) {
  return found
    .flatMap((diagnostic) => {
      if (diagnostic.start === undefined) return [];
      const range = localSpan(
        { start: diagnostic.start, length: diagnostic.length ?? 0 },
        input.base,
        input.length,
      );
      if (range === null) return [];
      return [
        {
          message: diagnostic.message,
          severity: severityOf(diagnostic.category, input.categories),
          range,
        },
      ];
    })
    .toSorted((a, b) => a.range.start - b.range.start);
}
