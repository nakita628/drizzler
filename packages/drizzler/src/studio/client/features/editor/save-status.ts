/** A syntax error of the schema, where the parser stopped. */
export type ParseError = {
  readonly message: string;
  readonly line: number;
  readonly column: number;
};

/**
 * What the editor's status chip says of the schema file: a syntax error first, then saving,
 * then changes not saved yet, else saved; with the colour it is drawn in.
 */
export function saveStatus(input: {
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
