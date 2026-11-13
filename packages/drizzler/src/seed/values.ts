import type { Faker } from "@faker-js/faker";
import type { LooseFieldRule, SeedRow, SeedValue } from "./config.js";
import type { SeedColumn } from "./schema.js";

/** Whether a value is one a cell may hold: a scalar, a date, bytes, null, or a list or JSON of them. */
export function isSeedValue(value: unknown): value is SeedValue {
  if (value === null) return true;
  if (["string", "number", "bigint", "boolean"].includes(typeof value)) return true;
  if (value instanceof Date || value instanceof Uint8Array) return true;
  if (Array.isArray(value)) return value.every(isSeedValue);
  return typeof value === "object" && Object.values(value).every(isSeedValue);
}

/**
 * A value a column's own default, `$defaultFn()` or `$onUpdate()` gave, as a cell holds it;
 * anything else (a class instance a custom type makes) is written as its JSON, `undefined` as null.
 */
export function toSeedValue(value: unknown): SeedValue {
  return isSeedValue(value) ? value : (JSON.stringify(value) ?? null);
}

/** What holds for every column: the config's null rate and date window. */
export type Bounds = {
  readonly nullRate: number | null;
  readonly dates: { readonly from: Date; readonly to: Date } | null;
};

const YEAR = 365 * 24 * 60 * 60 * 1000;

type ObjectRule = Exclude<LooseFieldRule, (...args: never[]) => unknown>;

function normalizedName(name: string) {
  return name.toLowerCase().replaceAll(/[_-]/gu, "");
}

/** Whether the value is a Drizzle `sql` expression: a default the seeder cannot bind. */
export function isSqlExpression(value: unknown) {
  return typeof value === "object" && value !== null && "queryChunks" in value;
}

/**
 * A date in the column's window, the config's window, or, with neither, faker's own: the year
 * before the run. A window with one edge is a year long.
 */
export function dateBetween(faker: Faker, rule: ObjectRule, bounds: Bounds) {
  const to =
    rule.to === undefined
      ? (bounds.dates?.to ?? new Date(faker.defaultRefDate()))
      : new Date(rule.to);
  const from =
    rule.from === undefined
      ? (bounds.dates?.from ?? new Date(to.getTime() - YEAR))
      : new Date(rule.from);
  return faker.date.between(from <= to ? { from, to } : { from: to, to: from });
}

/** A date as the text a `mode: "string"` column takes: `2025-03-02`, `08:15:00` or both. */
export function dateText(date: Date, format: SeedColumn["format"]) {
  const iso = date.toISOString();
  if (format === "date") return iso.slice(0, 10);
  if (format === "time") return iso.slice(11, 19);
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)}`;
}

// The patterns match column names with their underscores removed and lower-cased (`postal_code`
// reads `postalcode`), which is why the tokens below are not words.
// cspell:ignore emailaddress postalcode couponcode promocode passwordhash colou organi ation currencycode
const TEXT_PATTERNS = [
  [/^(e?mail|emailaddress)$/u, (faker) => faker.internet.email().toLowerCase()],
  [/^(full|display)?name$/u, (faker) => faker.person.fullName()],
  [/^(user|nick|screen)name$|^(handle|login)$/u, (faker) => faker.internet.username()],
  [/^(first|given)name$/u, (faker) => faker.person.firstName()],
  [/^(last|family|sur)name$/u, (faker) => faker.person.lastName()],
  [
    /^(title|subject|headline|heading)$/u,
    (faker) => faker.lorem.sentence({ min: 3, max: 6 }).replace(/\.$/u, ""),
  ],
  [
    /^(body|content|description|bio|text|message|comment|summary|notes?|about|excerpt)$/u,
    (faker) => faker.lorem.paragraph(),
  ],
  [/^(url|uri|website|link|homepage)$/u, (faker) => faker.internet.url()],
  [/^(avatar|image|img|thumbnail|photo|picture)(url)?$/u, (faker) => faker.image.avatar()],
  [/^(phone|tel|telephone|mobile)(number)?$/u, (faker) => faker.phone.number()],
  [/^(street)?address(line\d)?$|^street$/u, (faker) => faker.location.streetAddress()],
  [/^city$/u, (faker) => faker.location.city()],
  [/^country$/u, (faker) => faker.location.country()],
  [/^(state|prefecture|region|province)$/u, (faker) => faker.location.state()],
  [/^(zip|zipcode|postalcode|postcode)$/u, (faker) => faker.location.zipCode()],
  [/^slug$/u, (faker) => faker.lorem.slug()],
  [
    /^(sku|code|coupon|couponcode|promocode)$/u,
    (faker) => faker.string.alphanumeric({ length: 8, casing: "upper" }),
  ],
  [/^(password|passwordhash|hash|digest)$/u, (faker) => faker.internet.password()],
  [/^(ip|ipaddress)$/u, (faker) => faker.internet.ip()],
  [/^colou?r$/u, (faker) => faker.color.human()],
  [/^(company|organi[sz]ation|vendor|employer)$/u, (faker) => faker.company.name()],
  [
    /^(label|tag|tagname|keyword|category|categoryname|genre|topic|action)$/u,
    (faker) => faker.lorem.word(),
  ],
  [/^(currency|currencycode)$/u, (faker) => faker.finance.currencyCode()],
  [/^(token|apikey|secret|signature|key)$/u, (faker) => faker.string.alphanumeric(32)],
  [/^(uuid|guid)$/u, (faker) => faker.string.uuid()],
] as const satisfies readonly (readonly [RegExp, (faker: Faker) => string])[];

function makeText(faker: Faker, name: string) {
  const match = TEXT_PATTERNS.find(([pattern]) => pattern.test(name));
  return match === undefined ? faker.lorem.words({ min: 1, max: 3 }) : match[1](faker);
}

// The column's own length (`varchar({ length: 64 })`); a rule's `length` narrows it.
function maxLength(column: SeedColumn, rule: ObjectRule) {
  const ruled = typeof rule.length === "number" ? rule.length : rule.length?.max;
  const bounds = [column.length ?? undefined, ruled].filter(
    (n): n is number => n !== undefined && n > 0,
  );
  return bounds.length === 0 ? null : Math.min(...bounds);
}

function makeString(faker: Faker, column: SeedColumn, rule: ObjectRule) {
  const text = makeText(faker, normalizedName(column.field));
  const limit = maxLength(column, rule);
  return limit === null ? text : text.slice(0, limit);
}

type Range = { readonly min: number; readonly max: number };

// The range a column's name suggests, by the first pattern it matches.
const INT_RANGES = [
  [/^age$/u, { min: 18, max: 90 }],
  [/^year$/u, { min: 1970, max: 2030 }],
  [/^(qty|quantity)$/u, { min: 1, max: 20 }],
  [/^(rating|stars)$/u, { min: 1, max: 5 }],
  [/^(price|amount|total|balance|salary|cost|fee)$/u, { min: 0, max: 100_000 }],
] as const satisfies readonly (readonly [RegExp, Range])[];

const FLOAT_RANGES = [
  [/^(lat|latitude)$/u, { min: -90, max: 90 }],
  [/^(lng|lon|long|longitude)$/u, { min: -180, max: 180 }],
  [/^(price|amount|total|balance|salary|cost|fee)$/u, { min: 0, max: 10_000 }],
] as const satisfies readonly (readonly [RegExp, Range])[];

const DEFAULT_RANGE = { min: 0, max: 1000 } as const satisfies Range;

function naturalRange(name: string, ranges: readonly (readonly [RegExp, Range])[]): Range {
  return ranges.find(([pattern]) => pattern.test(name))?.[1] ?? DEFAULT_RANGE;
}

function intRange(column: SeedColumn, rule: ObjectRule) {
  const natural = naturalRange(normalizedName(column.field), INT_RANGES);
  // The column cannot hold more than its type, so a natural range is cut to fit.
  const stored = column.range ?? { min: -Infinity, max: Infinity };
  const min = rule.min ?? Math.max(natural.min, stored.min);
  const max = rule.max ?? Math.min(natural.max, stored.max);
  return { min, max: Math.max(min, max) };
}

function floatRange(column: SeedColumn, rule: ObjectRule) {
  const natural = naturalRange(normalizedName(column.field), FLOAT_RANGES);
  return { min: rule.min ?? natural.min, max: rule.max ?? natural.max };
}

function makeDecimal(faker: Faker, column: SeedColumn, rule: ObjectRule) {
  const precision = column.precision ?? 10;
  const scale = column.scale ?? 2;
  const range = floatRange(column, rule);
  // The column cannot hold more digits than its precision, so a rule beyond it is cut to fit.
  const ceiling = 10 ** (precision - scale) - 1;
  const min = Math.min(Math.max(range.min, -ceiling), ceiling);
  const max = Math.max(Math.min(range.max, ceiling), min);
  return faker.number.float({ min, max, fractionDigits: scale }).toFixed(scale);
}

function makeJson(faker: Faker) {
  return {
    note: faker.lorem.sentence(),
    tags: faker.lorem.words({ min: 1, max: 3 }).split(" "),
    score: faker.number.int({ min: 0, max: 100 }),
  };
}

/** One scalar of the column's kind, honouring its name and the rule's bounds; null for a kind the seeder cannot make. */
function makeScalar(
  faker: Faker,
  column: SeedColumn,
  rule: ObjectRule,
  bounds: Bounds,
  index: number,
): SeedValue {
  switch (column.kind) {
    case "enum":
      return faker.helpers.arrayElement(column.enumValues ?? [null]);
    case "string":
      return makeString(faker, column, rule);
    case "uuid":
      return faker.string.uuid();
    case "int": {
      const unbounded = rule.min === undefined && rule.max === undefined;
      return column.isId && unbounded ? index + 1 : faker.number.int(intRange(column, rule));
    }
    case "bigint": {
      const unbounded = rule.min === undefined && rule.max === undefined;
      const range = intRange(column, rule);
      return column.isId && unbounded
        ? BigInt(index + 1)
        : faker.number.bigInt({ min: range.min, max: range.max });
    }
    case "float":
      return faker.number.float({ ...floatRange(column, rule), fractionDigits: 2 });
    case "decimal":
      return makeDecimal(faker, column, rule);
    case "boolean":
      return faker.datatype.boolean();
    case "date":
      return dateBetween(faker, rule, bounds);
    case "dateString":
      return dateText(dateBetween(faker, rule, bounds), column.format);
    case "json":
      return makeJson(faker);
    case "bytes":
      return Uint8Array.from(
        Buffer.from(faker.string.hexadecimal({ length: 32, prefix: "", casing: "lower" }), "hex"),
      );
    case "inet":
      return faker.internet.ip();
    case "cidr":
      return `${faker.internet.ip()}/32`;
    case "mac":
      return faker.internet.mac();
    case "interval":
      return `${faker.number.int({ min: 1, max: 30 })} days`;
    default:
      return null;
  }
}

function listLength(faker: Faker, rule: ObjectRule) {
  const range =
    typeof rule.length === "number"
      ? { min: rule.length, max: rule.length }
      : (rule.length ?? { min: rule.min ?? 0, max: rule.max ?? 3 });
  return faker.number.int({ min: range.min, max: Math.max(range.min, range.max) });
}

/**
 * The value the column fills itself with when a row leaves it out: the next number of an
 * autoincrement, what a `$defaultFn()` returns, a date or a uuid for a SQL default such as
 * `defaultNow()` or `defaultRandom()`. Null when it has no such default.
 */
export function generatedDefault(
  faker: Faker,
  column: SeedColumn,
  rule: ObjectRule,
  bounds: Bounds,
  index: number,
): SeedValue | null {
  if (column.autoincrement) return column.kind === "bigint" ? BigInt(index + 1) : index + 1;
  const kind = column.default?.kind;
  if (kind !== "fn" && kind !== "sql") return null;
  // A date the database or the app stamps (`defaultNow()`, `$defaultFn(() => new Date())`) is
  // spread over the window, as rows written over time would be.
  if (column.kind === "date") return dateBetween(faker, rule, bounds);
  if (column.kind === "dateString")
    return dateText(dateBetween(faker, rule, bounds), column.format);
  if (column.default?.kind === "fn") {
    const made = column.default.fn();
    // A `$defaultFn(() => sql`...`)` is for the database to run; the seeder makes its own.
    if (!isSqlExpression(made)) return toSeedValue(made);
  }
  if (column.kind === "uuid") return faker.string.uuid();
  return null;
}

/**
 * The value of one column of one faker row. A rule function wins outright; a rule object narrows
 * what the column's kind and name would otherwise produce.
 */
export function makeFieldValue(input: {
  readonly faker: Faker;
  readonly column: SeedColumn;
  readonly rule: LooseFieldRule | undefined;
  readonly bounds: Bounds;
  readonly index: number;
  readonly row: SeedRow;
}): SeedValue {
  const { faker, column, bounds, index, row } = input;
  if (typeof input.rule === "function") return input.rule(faker, { index, row });
  const rule = input.rule ?? {};
  if (rule.value !== undefined) return rule.value;
  if (!column.isRequired && !column.isList) {
    const nullRate = rule.nullRate ?? bounds.nullRate ?? 0;
    if (nullRate > 0 && faker.datatype.boolean({ probability: nullRate })) return null;
  }
  const choices = rule.values !== undefined && rule.values.length > 0 ? rule.values : null;
  if (choices !== null && !column.isList) return faker.helpers.arrayElement(choices);
  if (column.isList) {
    const length = listLength(faker, rule);
    if (choices !== null) return faker.helpers.arrayElements(choices, length);
    return Array.from({ length }, () =>
      makeScalar(faker, column, { ...rule, min: undefined, max: undefined }, bounds, index),
    );
  }
  const bounded = rule.min !== undefined || rule.max !== undefined;
  const generated = bounded ? null : generatedDefault(faker, column, rule, bounds, index);
  return generated ?? makeScalar(faker, column, rule, bounds, index);
}
