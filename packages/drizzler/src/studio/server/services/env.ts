import { Config, Effect } from "effect";

/**
 * Reads environment variables through Effect's Config, so a test can hand it a ConfigProvider.
 * One that is not set is null; one that cannot be read is logged and null, so reading never fails.
 *
 * ```mermaid
 * flowchart LR
 *   names[input.names] --> config[(Effect Config: the environment)]
 *   config --> values[value by name, null when unset]
 * ```
 *
 * @param input.names - the variables to read
 * @returns each variable's value by name, null for one that is not set
 */
export function readEnv(input: { readonly names: readonly string[] }) {
  return Effect.forEach(input.names, (name) =>
    Config.option(Config.String(name)).pipe(
      Effect.map((value) => [name, value._tag === "Some" ? value.value : null] as const),
      Effect.catch((error) =>
        Effect.as(Effect.logWarning(`cannot read ${name}`, error), [name, null] as const),
      ),
    ),
  ).pipe(
    Effect.map((entries): Readonly<Record<string, string | null>> => Object.fromEntries(entries)),
  );
}
