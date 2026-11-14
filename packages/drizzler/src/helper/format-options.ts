/** The oxfmt options the studio reads from the project's config and passes on. */
export type FormatOptions = {
  readonly printWidth?: number;
  readonly tabWidth?: number;
  readonly useTabs?: boolean;
  readonly semi?: boolean;
  readonly singleQuote?: boolean;
  readonly trailingComma?: "all" | "es5" | "none";
  readonly bracketSpacing?: boolean;
  readonly arrowParens?: "always" | "avoid";
};

const OPTION_NAMES: ReadonlySet<string> = new Set([
  "printWidth",
  "tabWidth",
  "useTabs",
  "semi",
  "singleQuote",
  "trailingComma",
  "bracketSpacing",
  "arrowParens",
]);

/** The options of a parsed oxfmt config the studio passes on; the rest are left out. */
export function pickFormatOptions(config: unknown): FormatOptions {
  if (typeof config !== "object" || config === null) return {};
  return Object.fromEntries(
    Object.entries(config).filter(([key, option]) => OPTION_NAMES.has(key) && option !== undefined),
  );
}
