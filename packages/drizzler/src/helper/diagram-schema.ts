import type { CallExpression, Expression, Node, Program } from "oxc-parser";
import type {
  DiagramIndex,
  SchemaEnum,
  SchemaField,
  SchemaModel,
  SchemaRelation,
} from "../types/index.js";
import {
  descriptionBefore,
  declaratorName,
  columnProperties,
  isArrow,
  topLevelDeclarations,
  isCall,
  isObject,
  isPropertyAssignment,
  parseSource,
  textOf,
  unwrapParens,
} from "./ast.js";
import { constraintEntries, tableCalls } from "./extract-tables.js";
import { mergeRelations } from "./merge-relations.js";

type ChainMethod = { readonly name: string; readonly args: CallExpression["arguments"] };

/**
 * A builder chain such as `text('user_id').notNull().references(() => user.id)`, read from the
 * outside in: the builder at its root (`text`, or `integer` in the callback form
 * `t.integer()`), then each method in the order it was written. Null for anything else.
 */
function readChain(expr: Expression): {
  readonly builder: string;
  readonly args: CallExpression["arguments"];
  readonly methods: readonly ChainMethod[];
} | null {
  if (!isCall(expr)) return null;
  const { callee } = expr;
  if (callee.type === "Identifier")
    return { builder: callee.name, args: expr.arguments, methods: [] };
  if (callee.type !== "MemberExpression" || callee.computed) return null;
  if (callee.property.type !== "Identifier") return null;
  if (!isCall(callee.object)) {
    return { builder: callee.property.name, args: expr.arguments, methods: [] };
  }
  const inner = readChain(callee.object);
  if (inner === null) return null;
  return {
    ...inner,
    methods: [...inner.methods, { name: callee.property.name, args: expr.arguments }],
  };
}

function stringLiteral(node: Node | undefined) {
  return node?.type === "Literal" && typeof node.value === "string" ? node.value : null;
}

// The column a `t.col` / `table.col` argument names.
function columnName(node: Node) {
  return node.type === "MemberExpression" && !node.computed && node.property.type === "Identifier"
    ? node.property.name
    : null;
}

function columnNames(nodes: readonly Node[]) {
  return nodes.map(columnName).filter((name): name is string => name !== null);
}

// The string values of `{ onDelete: 'cascade', onUpdate: 'restrict' }`.
function referentialActions(node: Node | undefined) {
  if (!isObject(node)) return { onDelete: null, onUpdate: null };
  const { properties } = node;
  function value(key: string) {
    const prop = properties.find(
      (p) => isPropertyAssignment(p) && p.key.type === "Identifier" && p.key.name === key,
    );
    return prop && isPropertyAssignment(prop) ? stringLiteral(prop.value) : null;
  }
  return { onDelete: value("onDelete"), onUpdate: value("onUpdate") };
}

// What the drawing writes under a field: the defaults and generated values the
// row does not show another way, as they are written in the schema.
function fieldNotes(methods: readonly ChainMethod[], text: string) {
  return methods.flatMap(({ name, args }) => {
    if (name === "default") return [`.default(${args.map((a) => textOf(text, a)).join(", ")})`];
    if (name === "defaultNow" || name === "defaultRandom") return [`.${name}()`];
    if (name === "$defaultFn" || name === "$default") return [".$defaultFn()"];
    if (name === "$onUpdateFn" || name === "$onUpdate") return [".$onUpdate()"];
    if (name === "generatedAlwaysAs") return [".generatedAlwaysAs()"];
    return [];
  });
}

const INDEX_TYPES = new Map<string, DiagramIndex["type"]>([
  ["primaryKey", "id"],
  ["unique", "unique"],
  ["uniqueIndex", "unique"],
  ["index", "normal"],
]);

type Constraint =
  | {
      readonly kind: "fk";
      readonly column: string;
      readonly onDelete: string | null;
      readonly onUpdate: string | null;
    }
  | { readonly kind: "index"; readonly index: DiagramIndex };

function readConstraints(arg: CallExpression["arguments"][number] | undefined) {
  return constraintEntries(arg).flatMap((entry): Constraint[] => {
    const chain = readChain(entry);
    if (chain === null) return [];
    if (chain.builder === "foreignKey") {
      const config = chain.args[0];
      if (!isObject(config)) return [];
      const columns = config.properties.find(
        (p) => isPropertyAssignment(p) && p.key.type === "Identifier" && p.key.name === "columns",
      );
      if (!(columns && isPropertyAssignment(columns) && columns.value.type === "ArrayExpression")) {
        return [];
      }
      const [column] = columnNames(columns.value.elements.filter((e) => e !== null));
      const { methods } = chain;
      function action(name: string) {
        return stringLiteral(methods.find((m) => m.name === name)?.args[0]);
      }
      return column
        ? [{ kind: "fk", column, onDelete: action("onDelete"), onUpdate: action("onUpdate") }]
        : [];
    }
    const type = INDEX_TYPES.get(chain.builder);
    if (!type) return [];
    // `primaryKey({ columns: [t.a, t.b] })`, or the older `primaryKey(t.a, t.b)`.
    const config = chain.args[0];
    const listed =
      isObject(config) &&
      config.properties.find(
        (p) => isPropertyAssignment(p) && p.key.type === "Identifier" && p.key.name === "columns",
      );
    const fromConfig =
      listed && isPropertyAssignment(listed) && listed.value.type === "ArrayExpression"
        ? columnNames(listed.value.elements.filter((e) => e !== null))
        : columnNames(chain.args);
    const on = chain.methods.find((m) => m.name === "on");
    const fields = on ? columnNames(on.args) : fromConfig;
    // `index("users_email_idx")`, `unique("name")`, or `primaryKey({ name, columns })`.
    const named =
      isObject(config) &&
      config.properties.find(
        (p) => isPropertyAssignment(p) && p.key.type === "Identifier" && p.key.name === "name",
      );
    const name =
      named && isPropertyAssignment(named) ? stringLiteral(named.value) : stringLiteral(config);
    const index: DiagramIndex = name === null ? { type, fields } : { type, fields, name };
    return fields.length > 0 ? [{ kind: "index", index }] : [];
  });
}

// `export const role = pgEnum('role', ['admin', 'member'])`.
function readEnums(program: Program, source: Parameters<typeof descriptionBefore>[0]) {
  return topLevelDeclarations(program).flatMap(({ declarator, start }): SchemaEnum[] => {
    const name = declaratorName(declarator);
    const init = declarator.init;
    if (name === null || !isCall(init) || init.callee.type !== "Identifier") return [];
    if (!init.callee.name.endsWith("Enum")) return [];
    const [dbName, values] = init.arguments;
    if (values?.type !== "ArrayExpression") return [];
    const literal = stringLiteral(dbName);
    return [
      {
        name,
        dbName: literal !== null && literal !== name ? literal : null,
        documentation: descriptionBefore(source, start),
        values: values.elements
          .map((e) => stringLiteral(e ?? undefined))
          .filter((v): v is string => v !== null)
          .map((v) => ({ name: v, dbName: null })),
      },
    ];
  });
}

// A column name as drizzle's snake_case casing writes it: `emailVerified` -> `email_verified`.
function toSnakeCase(name: string) {
  const words = name.replace(/['\u2019]/gu, "").match(/[\da-z]+|[A-Z]+(?![a-z])|[A-Z][\da-z]+/gu);
  return (words ?? []).map((word) => word.toLowerCase()).join("_");
}

/**
 * The name each table creator gives a table, by the creator's variable:
 * `const createTable = pgTableCreator((name) => \`project1_${name}\`)` makes
 * `createTable("post")` the table `project1_post`. Only a template of the name is read.
 */
function tableCreators(program: Program) {
  return new Map(
    topLevelDeclarations(program).flatMap(({ declarator }) => {
      const name = declaratorName(declarator);
      const init = declarator.init;
      if (name === null || !isCall(init) || init.callee.type !== "Identifier") return [];
      if (!init.callee.name.endsWith("TableCreator")) return [];
      const [make] = init.arguments;
      if (!isArrow(make)) return [];
      const [param] = make.params;
      const body = make.body.type === "BlockStatement" ? null : unwrapParens(make.body);
      if (param?.type !== "Identifier" || body?.type !== "TemplateLiteral") return [];
      if (!body.expressions.every((e) => e.type === "Identifier" && e.name === param.name)) {
        return [];
      }
      const parts = body.quasis.map((q) => q.value.cooked ?? "");
      return [[name, (table: string) => parts.join(table)] as const];
    }),
  );
}

/**
 * The Drizzle schema as the ER diagram draws it: a card per table with a row
 * per column, a card per `pgEnum`, and the relations `mergeRelations` finds
 * (foreign keys and `defineRelations` exports); a table, column or enum is
 * described by the comment written above it.
 */
export function diagramSchema(code: readonly string[]) {
  const source = parseSource(code);
  const { program, text } = source;
  const enums = readEnums(program, source);
  const enumNames = new Set(enums.map((e) => e.name));
  const merged = mergeRelations(code);
  const foreignKeys = new Set(merged.map((r) => `${r.to.model}.${r.to.field}`));
  const actions = new Map<string, { onDelete: string | null; onUpdate: string | null }>();

  const creators = tableCreators(program);

  const models = tableCalls(program, text).flatMap(({ varName, callee, args, start }) => {
    const columns = args[1];
    // `snakeCase.table(...)` names a column it is not given a name for in snake_case.
    const snakeCase = /^snakeCase\.table\b/u.test(textOf(text, callee).replace(/\s+/gu, ""));
    if (!isObject(columns) && !isArrow(columns) && columns?.type !== "Identifier") return [];
    const constraints = readConstraints(args[2]);
    for (const c of constraints) {
      if (c.kind === "fk") actions.set(`${varName}.${c.column}`, c);
    }
    const indexes = constraints.flatMap((c) => (c.kind === "index" ? [c.index] : []));
    const compositeKey = indexes.find((i) => i.type === "id")?.fields ?? null;

    const fields = columnProperties(columns, program).flatMap((prop): SchemaField[] => {
      if (prop.computed || prop.key.type !== "Identifier") return [];
      const name = prop.key.name;
      const chain = readChain(prop.value);
      if (chain === null) return [];
      const { methods } = chain;
      function has(method: string) {
        return methods.some((m) => m.name === method);
      }
      const references = chain.methods.find((m) => m.name === "references");
      if (references) actions.set(`${varName}.${name}`, referentialActions(references.args[1]));
      const dbName = stringLiteral(chain.args[0]) ?? (snakeCase ? toSnakeCase(name) : name);
      const isId = has("primaryKey");
      const withTimezone = chain.args.some(
        (arg) =>
          isObject(arg) &&
          arg.properties.some(
            (p) =>
              isPropertyAssignment(p) &&
              p.key.type === "Identifier" &&
              p.key.name === "withTimezone" &&
              p.value.type === "Literal" &&
              p.value.value === true,
          ),
      );
      return [
        {
          name,
          dbName: dbName !== name ? dbName : null,
          kind: enumNames.has(chain.builder) ? "enum" : "scalar",
          type: chain.builder,
          isList: has("array"),
          isRequired: isId || has("notNull"),
          isId,
          isUnique: has("unique"),
          isForeignKey: references !== undefined || foreignKeys.has(`${varName}.${name}`),
          documentation: descriptionBefore(source, prop.start),
          attributes: fieldNotes(chain.methods, text),
          ...(withTimezone ? { withTimezone: true as const } : {}),
        },
      ];
    });

    // The table's name in the database: the one it is given, through its creator's template.
    const given = stringLiteral(args[0]);
    const creator = callee.type === "Identifier" ? creators.get(callee.name) : undefined;
    const tableName = given === null ? null : (creator?.(given) ?? given);
    return [
      {
        name: varName,
        dbName: tableName !== null && tableName !== varName ? tableName : null,
        documentation: descriptionBefore(source, start),
        primaryKey: compositeKey,
        fields,
        indexes: indexes.filter((i) => i.type !== "id" || i.fields.length > 1),
      } satisfies SchemaModel,
    ];
  });

  const relations = merged.map((r): SchemaRelation => ({
    origin: r.origin,
    name: null,
    onDelete: actions.get(`${r.to.model}.${r.to.field}`)?.onDelete ?? null,
    onUpdate: actions.get(`${r.to.model}.${r.to.field}`)?.onUpdate ?? null,
    from: r.from,
    to: r.to,
  }));

  return { models, relations, enums };
}
