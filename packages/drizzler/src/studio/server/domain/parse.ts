import * as z from "zod";

const MakePositionInput = z
  .object({
    source: z.string().meta({ description: "The text the offset points into" }),
    offset: z.number().meta({ description: "A UTF-16 offset into it", example: 42 }),
  })
  .readonly()
  .meta({ description: "An offset into a text" });

/**
 * The 1-based line and column a UTF-16 offset of `source` falls on.
 *
 * @param input - The `source` text and an `offset` into it.
 * @returns The `line` and `column`, both counted from 1.
 * @example
 * ```ts
 * makePosition({ source: "a\nbc", offset: 3 });
 * // => { line: 2, column: 2 }
 * ```
 */
export function makePosition(input: z.infer<typeof MakePositionInput>) {
  const before = input.source.slice(0, input.offset).split("\n");
  return { line: before.length, column: (before.at(-1)?.length ?? 0) + 1 };
}

const MakeParseErrorInput = z
  .object({
    source: z.string().meta({ description: "The schema source" }),
    error: z
      .object({
        message: z.string().meta({ description: "What the parser says" }),
        offset: z.number().meta({ description: "Where the error starts, as a UTF-16 offset" }),
      })
      .readonly()
      .nullable()
      .meta({ description: "The first syntax error the parser found; null when it parsed" }),
  })
  .readonly()
  .meta({ description: "A schema source and the syntax error found in it" });

/**
 * The syntax error with the line and column it starts on, or null when the source parsed.
 *
 * @param input - The schema `source` and the `error` the parser found in it (null when none).
 * @returns The error's `message`, `line` and `column`, or null.
 * @example
 * ```ts
 * makeParseError({ source: "a\nb(", error: { message: "Unexpected token", offset: 3 } });
 * // => { message: "Unexpected token", line: 2, column: 2 }
 * makeParseError({ source: "", error: null });
 * // => null
 * ```
 */
export function makeParseError(input: z.infer<typeof MakeParseErrorInput>) {
  if (input.error === null) return null;
  const position = makePosition({ source: input.source, offset: input.error.offset });
  return { message: input.error.message, ...position };
}
