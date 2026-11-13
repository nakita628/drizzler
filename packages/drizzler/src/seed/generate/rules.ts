import { Effect } from "effect";
import type { LooseModelRule, SeedRow } from "../config.js";
import { SeedGenerationError } from "../errors.js";
import type { ResolvedSeedConfig } from "../options.js";
import type { ModelTable } from "../schema.js";
import { isKeyObject, isSeedList, modelTable } from "./context.js";

/** What is wrong in one real row and the rows nested in it, as sentences. */
function checkDataRow(
  tables: readonly ModelTable[],
  table: ModelTable,
  row: SeedRow,
  where: string,
): readonly string[] {
  const columns = new Set(table.columns.map((column) => column.field));
  const keysByField = Map.groupBy(table.foreignKeys, (key) => key.field);
  const parentsByName = Map.groupBy(table.parents, (side) => side.name);
  return Object.entries(row).flatMap(([name, value]) => {
    if (columns.has(name)) return [];
    const fk = keysByField.get(name)?.[0];
    if (fk !== undefined) {
      return isKeyObject(value)
        ? []
        : [
            `${where}.${name}: name the ${fk.toModel} row by a unique key, \`{ id }\` or \`{ email }\`, or give ${fk.fromFields.join(", ")}.`,
          ];
    }
    const parent = parentsByName.get(name)?.[0];
    const child = parent === undefined ? undefined : modelTable(tables, parent.child);
    if (parent === undefined || child === undefined) {
      return [
        `${where}.${name}: ${table.name} has no column or relation named ${name} the seeder can write.`,
      ];
    }
    const nested = isSeedList(value) ? value : [value];
    return nested.flatMap((item, i) =>
      isKeyObject(item)
        ? checkDataRow(
            tables,
            child,
            item,
            parent.isList ? `${where}.${name}[${i}]` : `${where}.${name}`,
          )
        : [`${where}.${name}: expected ${parent.isList ? "rows" : "a row"} of ${child.name}.`],
    );
  });
}

/** What is wrong with the rules for one model, as sentences; nothing when they fit the schema. */
function checkModel(name: string, rule: LooseModelRule, tables: readonly ModelTable[]) {
  const table = modelTable(tables, name);
  if (table === undefined) {
    return [`models.${name}: the schema exports no table named ${name}.`];
  }
  const columns = new Set(table.columns.map((column) => column.field));
  const fields = Object.keys(rule.fields ?? {}).flatMap((field) =>
    columns.has(field)
      ? []
      : [`models.${name}.fields.${field}: ${name} has no column named ${field} the seeder writes.`],
  );
  const data = (rule.data ?? []).flatMap((row, index) =>
    checkDataRow(tables, table, row, `models.${name}.data[${index}]`),
  );
  const bounds = Object.entries(rule.fields ?? {}).flatMap(([field, fieldRule]) => {
    if (typeof fieldRule === "function") return [];
    const range = typeof fieldRule.length === "object" ? fieldRule.length : null;
    const inverted =
      fieldRule.min !== undefined && fieldRule.max !== undefined && fieldRule.min > fieldRule.max;
    const invertedLength = range !== null && range.min > range.max;
    const dated =
      fieldRule.from !== undefined &&
      fieldRule.to !== undefined &&
      new Date(fieldRule.from).getTime() > new Date(fieldRule.to).getTime();
    const problems: readonly (readonly [boolean, string])[] = [
      [
        inverted,
        `models.${name}.fields.${field}: min ${String(fieldRule.min)} is above max ${String(fieldRule.max)}.`,
      ],
      [
        invertedLength,
        `models.${name}.fields.${field}: length.min ${String(range?.min)} is above length.max ${String(range?.max)}.`,
      ],
      [
        dated,
        `models.${name}.fields.${field}: from ${new Date(fieldRule.from ?? 0).toISOString()} is after to ${new Date(fieldRule.to ?? 0).toISOString()}.`,
      ],
    ];
    return problems.filter(([found]) => found).map(([, message]) => message);
  });
  const relationNames = new Set(table.parents.map((side) => side.name));
  const relations = Object.entries(rule.relations ?? {}).flatMap(([field, bound]) => {
    if (!relationNames.has(field)) {
      return [
        `models.${name}.relations.${field}: ${name} has no relation named ${field} that a rule can bound (an r.many whose child points back by a key).`,
      ];
    }
    return bound.min !== undefined && bound.max !== undefined && bound.min > bound.max
      ? [
          `models.${name}.relations.${field}: min ${String(bound.min)} is above max ${String(bound.max)}.`,
        ]
      : [];
  });
  const count =
    rule.count !== undefined && (!Number.isInteger(rule.count) || rule.count < 0)
      ? [`models.${name}.count: expected a non-negative integer, got ${String(rule.count)}.`]
      : [];
  const exclusive =
    rule.data !== undefined && (rule.count !== undefined || rule.fields !== undefined)
      ? [
          `models.${name}: \`data\` and \`count\` / \`fields\` are exclusive. Give the real rows in \`data\`, or let faker make them with \`count\` and \`fields\`, not both.`,
        ]
      : [];
  return [...fields, ...bounds, ...data, ...relations, ...count, ...exclusive];
}

/** Fails when a model rule names a table, column or relation the schema does not have. */
export function checkRules(tables: readonly ModelTable[], config: ResolvedSeedConfig) {
  return Effect.gen(function* () {
    const problems = Object.entries(config.models).flatMap(([name, rule]) =>
      checkModel(name, rule, tables),
    );
    if (problems.length > 0) yield* new SeedGenerationError({ message: problems.join("\n   ") });
  });
}
