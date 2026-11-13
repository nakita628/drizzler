import { Data, Effect } from "effect";
import { format } from "oxfmt";

/** oxfmt could not format the generated code. */
export class FormatError extends Data.TaggedError("FormatError")<{
  readonly message: string;
}> {}

/** Formats generated TypeScript with oxfmt, in the style drizzler writes its output. */
export function fmt(input: string) {
  return Effect.gen(function* () {
    const { code, errors } = yield* Effect.promise(() =>
      format("<stdin>.ts", input, { printWidth: 100, singleQuote: true, semi: false }),
    );
    if (errors.length > 0) {
      return yield* new FormatError({ message: errors.map((error) => error.message).join("\n") });
    }
    return code;
  });
}
