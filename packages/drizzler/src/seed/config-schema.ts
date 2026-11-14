// What `drizzler seed` accepts as its config, and the check of a loaded one. Pure: the check is
// Schema's synchronous decode, so it needs no Effect; seed/load-config.ts imports the module and
// hands its default export in.
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import { configIssuesMessage } from "./config-file.js";
import type { LooseFieldRule } from "./config.js";
import { SeedConfigError } from "./errors.js";
import { fail, ok } from "./result.js";
import { isSeedValue } from "./values.js";

const SeedValue = Schema.declare(isSeedValue, {
  expected: "a string, number, bigint, boolean, Date, bytes, null, or JSON of those",
});

const Generator = Schema.declare(
  (value): value is Extract<LooseFieldRule, (...args: never[]) => unknown> =>
    typeof value === "function",
  { expected: "a rule function (faker, { index, row }) => value" },
);

const SchemaModule = Schema.declare(
  (value): value is Readonly<Record<string, unknown>> =>
    typeof value === "object" && value !== null && !Array.isArray(value),
  { expected: "the schema module: import * as schema from './db/schema'" },
);

const NonNegativeInt = Schema.Int.pipe(Schema.check(Schema.isGreaterThanOrEqualTo(0)));

const Rate = Schema.Number.pipe(Schema.check(Schema.isBetween({ minimum: 0, maximum: 1 })));

const DateInput = Schema.declare(
  (value): value is string | Date =>
    value instanceof Date ||
    (typeof value === "string" && !Number.isNaN(new Date(value).getTime())),
  { expected: "a date" },
);

/** Whether the window `from`..`to` is the right way round; either edge missing is fine. */
const Ordered = Schema.makeFilter(
  (dates: { readonly from?: string | Date; readonly to?: string | Date }) =>
    dates.from === undefined ||
    dates.to === undefined ||
    new Date(dates.from).getTime() <= new Date(dates.to).getTime(),
  { expected: "from at or before to" },
);

const Bounded = Schema.makeFilter(
  (bounds: { readonly min?: number; readonly max?: number }) =>
    bounds.min === undefined || bounds.max === undefined || bounds.min <= bounds.max,
  { expected: "min at or below max" },
);

const Range = Schema.Struct({ min: NonNegativeInt, max: NonNegativeInt }).pipe(
  Schema.check(Bounded),
);

const FieldRuleObject = Schema.Struct({
  value: Schema.optionalKey(SeedValue),
  values: Schema.optionalKey(Schema.Array(SeedValue)),
  min: Schema.optionalKey(Schema.Number),
  max: Schema.optionalKey(Schema.Number),
  from: Schema.optionalKey(DateInput),
  to: Schema.optionalKey(DateInput),
  length: Schema.optionalKey(Schema.Union([NonNegativeInt, Range])),
  nullRate: Schema.optionalKey(Rate),
}).pipe(Schema.check(Bounded, Ordered));

const FieldRule = Schema.Union([Generator, FieldRuleObject]);

const RelationRule = Schema.Struct({
  min: Schema.optionalKey(NonNegativeInt),
  max: Schema.optionalKey(NonNegativeInt),
}).pipe(Schema.check(Bounded));

const ModelRule = Schema.Struct({
  count: Schema.optionalKey(NonNegativeInt),
  data: Schema.optionalKey(Schema.Array(Schema.Record(Schema.String, SeedValue))),
  fields: Schema.optionalKey(Schema.Record(Schema.String, FieldRule)),
  relations: Schema.optionalKey(Schema.Record(Schema.String, RelationRule)),
});

/** The loaded config as `drizzler seed` accepts it. */
const SeedConfig = Schema.Struct({
  schema: SchemaModule,
  seed: Schema.optionalKey(Schema.Int),
  locale: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  count: Schema.optionalKey(NonNegativeInt),
  nullRate: Schema.optionalKey(Rate),
  dates: Schema.optionalKey(
    Schema.Struct({ from: Schema.optionalKey(DateInput), to: Schema.optionalKey(DateInput) }).pipe(
      Schema.check(Ordered),
    ),
  ),
  output: Schema.optionalKey(Schema.String),
  url: Schema.optionalKey(Schema.String),
  reset: Schema.optionalKey(Schema.Boolean),
  models: Schema.optionalKey(Schema.Record(Schema.String, ModelRule)),
});

/** Every problem of a config, unknown keys included, so a typo is not ignored. */
const decode = Schema.decodeUnknownResult(SeedConfig, {
  errors: "all",
  onExcessProperty: "error",
});
const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

/**
 * A config module's default export checked against what `drizzler seed` accepts: the config, or
 * every problem as `path: message` under the file's name.
 */
export function decodeSeedConfig(file: string, exported: unknown) {
  const decoded = decode(exported);
  if (decoded._tag === "Success") return ok(decoded.success);
  return fail(
    new SeedConfigError({
      message: configIssuesMessage(file, formatIssues(decoded.failure.issue).issues),
    }),
  );
}
