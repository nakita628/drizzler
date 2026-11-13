import { getLanguage } from "../services/studio.js";
import type { DocumentKind } from "../services/typescript.js";

type Position = {
  readonly document: DocumentKind;
  readonly source: string;
  readonly offset: number;
};

/**
 * Whether the editor's TypeScript is loaded, loading, or unavailable, and why.
 *
 * @returns The language service's status.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant U as LanguageUseCase
 *   participant L as Language (TypeScript service)
 *   U->>L: status
 *   L-->>U: status
 * ```
 */
export function readLanguageStatus() {
  return getLanguage().status;
}

/**
 * The completions TypeScript offers at a position of the schema or a query.
 *
 * @param input - The `document` (schema or query), its `source` and the cursor `offset`.
 * @returns The completion entries. Fails with LanguageUnavailableError when TypeScript cannot load.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant U as LanguageUseCase
 *   participant L as Language (TypeScript service)
 *   U->>L: complete(document, source, offset)
 *   L-->>U: completions
 *   Note over U,L: LanguageUnavailableError
 * ```
 */
export function complete(input: Position) {
  return getLanguage().complete(input.document, input.source, input.offset);
}

/**
 * The detail of one completion entry: its signature and documentation.
 *
 * @param input - The `document`, its `source`, the cursor `offset` and the entry's `name`.
 * @returns The entry's detail. Fails with LanguageUnavailableError when TypeScript cannot load.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant U as LanguageUseCase
 *   participant L as Language (TypeScript service)
 *   U->>L: detail(document, source, offset, name)
 *   L-->>U: detail
 *   Note over U,L: LanguageUnavailableError
 * ```
 */
export function completeDetail(input: Position & { readonly name: string }) {
  return getLanguage().detail(input.document, input.source, input.offset, input.name);
}

/**
 * What TypeScript shows on hover at a position: the type and documentation of the symbol there.
 *
 * @param input - The `document`, its `source` and the cursor `offset`.
 * @returns The hover text, or none. Fails with LanguageUnavailableError when TypeScript cannot load.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant U as LanguageUseCase
 *   participant L as Language (TypeScript service)
 *   U->>L: hover(document, source, offset)
 *   L-->>U: hover
 *   Note over U,L: LanguageUnavailableError
 * ```
 */
export function hover(input: Position) {
  return getLanguage().hover(input.document, input.source, input.offset);
}

/**
 * The signature help at a position inside a call: the overloads and the active parameter.
 *
 * @param input - The `document`, its `source` and the cursor `offset`.
 * @returns The signature help, or none. Fails with LanguageUnavailableError when TypeScript cannot load.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant U as LanguageUseCase
 *   participant L as Language (TypeScript service)
 *   U->>L: signature(document, source, offset)
 *   L-->>U: signatures
 *   Note over U,L: LanguageUnavailableError
 * ```
 */
export function signature(input: Position) {
  return getLanguage().signature(input.document, input.source, input.offset);
}

/**
 * The type errors TypeScript reports for the schema or a query.
 *
 * @param input.document - Which text it is: the schema or a query.
 * @param input.source - Its text.
 * @returns The diagnostics. Fails with LanguageUnavailableError when TypeScript cannot load.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant U as LanguageUseCase
 *   participant L as Language (TypeScript service)
 *   U->>L: diagnostics(document, source)
 *   L-->>U: diagnostics
 *   Note over U,L: LanguageUnavailableError
 * ```
 */
export function diagnostics(input: { readonly document: DocumentKind; readonly source: string }) {
  return getLanguage().diagnostics(input.document, input.source);
}
