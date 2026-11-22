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
  helperCall,
  helperColumn,
  isArrow,
  topLevelDeclarations,
  isCall,
  isObject,
  isPropertyAssignment,
  parseSource,
  sourceText,
  textOf,
  topLevelValue,
  unwrapParens,
} from "./ast.js";
import { customTypeCallName, customTypeName, evaluateString, isCustomType } from "./custom-type.js";
import { asksForTimezone, constraintEntries, tableCalls } from "./extract-tables.js";
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
  /** The `customType({ ... })` call a column calls where it is built, if it does. */
  readonly custom?: CallExpression;
} | null {
  if (!isCall(expr)) return null;
  const { callee } = expr;
  if (callee.type === "Identifier")
    return { builder: callee.name, args: expr.arguments, methods: [] };
  // `customType({ ... })("token")`: a custom type called where it is built.
  if (isCustomType(callee)) {
    return { builder: "customType", args: expr.arguments, methods: [], custom: callee };
  }
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

type Chain = NonNullable<ReturnType<typeof readChain>>;

/**
 * The chain a column is built with, a helper function's included: for
 * `createdAt: createdAtField("at").unique()`, the chain the helper returns
 * (`integer(name).notNull()`) with each parameter read as what the call gives it (or its default),
 * then the methods the column adds (`.unique()`). A helper that calls another is followed too.
 */
function columnChain(expr: Expression, program: Program, depth = 0): Chain | null {
  const chain = readChain(expr);
  if (chain === null) return null;
  const helper = depth < 8 ? helperColumn(expr, program) : null;
  const inner = helper === null ? null : columnChain(helper.chain, program, depth + 1);
  if (helper === null || inner === null) return chain;
  function bind(arg: CallExpression["arguments"][number]) {
    return arg.type === "Identifier" ? (helper?.bindings.get(arg.name) ?? arg) : arg;
  }
  return {
    ...inner,
    args: inner.args.map(bind),
    methods: [
      ...inner.methods.map((m) => ({ name: m.name, args: m.args.map(bind) })),
      ...chain.methods,
    ],
  };
}

// A column's type: what the `customType()` it is built with makes (its `dataType`), not the custom
// type's name; else the builder it is built with.
function columnType(chain: Chain, program: Program) {
  const custom =
    chain.custom === undefined
      ? customTypeName(chain.builder, chain.args, program)
      : customTypeCallName(chain.custom, chain.args);
  return custom ?? chain.builder;
}

function stringLiteral(node: Node | undefined) {
  return node?.type === "Literal" && typeof node.value === "string" ? node.value : null;
}

// What an index may say of a column besides naming it: `t.createdAt.desc().nullsLast()`.
const COLUMN_MODIFIERS = new Set(["asc", "desc", "nullsFirst", "nullsLast", "op"]);

// The column a `t.col` / `table.col` argument names, under the order or operator class an index
// gives it (`t.createdAt.desc()`, `t.teamId.asc().nullsLast().op("text_ops")`).
function columnName(node: Node): string | null {
  if (
    isCall(node) &&
    node.callee.type === "MemberExpression" &&
    !node.callee.computed &&
    node.callee.property.type === "Identifier" &&
    COLUMN_MODIFIERS.has(node.callee.property.name)
  ) {
    return columnName(node.callee.object);
  }
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

// The methods that have the database generate a column's values.
const INCREMENTS = new Set([
  "autoincrement",
  "generatedAlwaysAsIdentity",
  "generatedByDefaultAsIdentity",
]);

// Whether the database generates the column's values: an identity column, MySQL's
// `.autoincrement()`, or SQLite's `primaryKey({ autoIncrement: true })`.
function increments(methods: readonly ChainMethod[]): { readonly isIncrement?: true } {
  const generated = methods.some(
    (m) =>
      INCREMENTS.has(m.name) ||
      (m.name === "primaryKey" && isTrue(optionValue(m.args[0], "autoIncrement"))),
  );
  return generated ? { isIncrement: true } : {};
}

function isTrue(node: Node | undefined) {
  return node?.type === "Literal" && node.value === true;
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

/** What the database does when the parent row changes, and the name of the key, if it has one. */
type KeyActions = {
  readonly onDelete: string | null;
  readonly onUpdate: string | null;
  readonly name: string | null;
};

type Constraint =
  | ({
      readonly kind: "fk";
      readonly columns: readonly string[];
      /** The table the key points at, by its variable. */
      readonly target: string;
    } & KeyActions)
  | { readonly kind: "index"; readonly index: DiagramIndex };

/**
 * A foreign key by its child columns and the table it points at, so two keys that start with the
 * same column (`team_id`, and `team_id, category_slug`) keep their own actions.
 */
function keyOf(table: string, columns: readonly string[], target: string) {
  return `${table}.${columns.join(",")}->${target}`;
}

// The table `() => users.id` points at, by its variable.
function referencedTable(target: Node | undefined) {
  if (!isArrow(target) || target.body.type === "BlockStatement") return null;
  const body = unwrapParens(target.body);
  return body.type === "MemberExpression" && body.object.type === "Identifier"
    ? body.object.name
    : null;
}

// The value of one key of an options object: `columns` in `primaryKey({ columns: [...] })`.
function optionValue(config: Node | undefined, key: string) {
  if (!isObject(config)) return undefined;
  const prop = config.properties.find(
    (p) => isPropertyAssignment(p) && p.key.type === "Identifier" && p.key.name === key,
  );
  return prop !== undefined && isPropertyAssignment(prop) ? prop.value : undefined;
}

// An index on an expression, `sql\`to_tsvector('english', ${table.body})\``: its text, each column
// it reads in its place. A top-level helper that returns one, `lower(table.email)` with
// `function lower(column) { return sql\`lower(${column})\` }`, is read with its parameters bound.
// Null for anything else.
function indexExpression(
  node: Node,
  source: { readonly program: Program; readonly text: string },
): DiagramIndex["expression"] | null {
  const { program } = source;
  const helper = isCall(node) ? helperCall(node, program) : null;
  const expr = helper === null ? node : helper.returned;
  if (expr.type !== "TaggedTemplateExpression" || expr.tag.type !== "Identifier") return null;
  if (expr.tag.name !== "sql") return null;
  const { quasis, expressions } = expr.quasi;
  return quasis.flatMap((q, i) => {
    const part = expressions[i];
    return [q.value.cooked ?? "", ...(part === undefined ? [] : expressionPart(part, source))];
  });
}

// What one `${...}` of an expression index reads: a column, a `sql` template or a helper that
// returns one (`${foldedEmail(table.email)}`), read in place, or else its text.
function expressionPart(
  part: Expression,
  source: { readonly program: Program; readonly text: string },
): NonNullable<DiagramIndex["expression"]> {
  const column = columnName(part);
  if (column !== null) return [{ field: column }];
  return indexExpression(part, source) ?? [sourceText(source.text, part)];
}

// The terms of an index when one of them is an expression: `.on(sql\`lower(${t.owner})\`, t.repo)`
// is `lower(owner), repo`, as the SQL lists them. Null when every term is a column.
function indexTerms(
  terms: readonly Node[],
  source: { readonly program: Program; readonly text: string },
): DiagramIndex["expression"] | null {
  const expressions = terms.map((term) => indexExpression(term, source));
  if (expressions.every((e) => e === null)) return null;
  return terms.flatMap((term, i) => {
    const separator = i === 0 ? [] : [", "];
    const column = columnName(term);
    const read = expressions[i] ?? [
      column === null ? sourceText(source.text, term) : { field: column },
    ];
    return [...separator, ...read];
  });
}

// The method `.using()` names, and the terms an index is on: the columns `.on()` lists, or the
// targets `.using()` gives after its method. Null terms when the builder lists its own columns.
function indexTargets(chain: Chain) {
  const on = chain.methods.find((m) => m.name === "on");
  const using = chain.methods.find((m) => m.name === "using");
  const [method, ...targets] = using?.args ?? [];
  if (on) return { method, terms: on.args };
  return { method, terms: using ? targets : null };
}

// The columns an index reads: those it lists, or each column its expression reads, once.
function indexFields(
  terms: readonly Node[],
  expression: DiagramIndex["expression"] | null | undefined,
) {
  if (expression === null || expression === undefined) return columnNames(terms);
  const read = expression.flatMap((part) => (typeof part === "string" ? [] : [part.field]));
  return [...new Set(read)];
}

// The name an index or constraint is given: `index("users_email_idx")`, `unique("name")`, or
// `primaryKey({ name, columns })`; a template a helper builds the name with is read too, the
// constants it reads (`MediaType.BOOKS`) included.
function indexName(config: Node | undefined, program: Program) {
  const named = optionValue(config, "name") ?? config;
  return named === undefined || isObject(named) ? null : evaluateString(named, program);
}

// An index or key constraint: `index("name").on(t.a, t.b.desc())`, `index("name").using("gin",
// t.search)` or on an expression, `unique().on(...)`, `primaryKey({ columns: [t.a, t.b] })` or the
// older `primaryKey(t.a, t.b)`. Null when it names no column.
function readIndex(
  chain: Chain,
  type: DiagramIndex["type"],
  source: { readonly program: Program; readonly text: string },
): DiagramIndex | null {
  const { program } = source;
  const config = chain.args[0];
  const listed = optionValue(config, "columns");
  const fromConfig =
    listed?.type === "ArrayExpression"
      ? columnNames(listed.elements.filter((e) => e !== null))
      : columnNames(chain.args);
  const { method, terms } = indexTargets(chain);
  const expression = terms === null ? null : indexTerms(terms, source);
  const fields = terms === null ? fromConfig : indexFields(terms, expression);
  const name = indexName(config, program);
  const indexMethod = stringLiteral(method);
  if (fields.length === 0 && expression === null) return null;
  return {
    type,
    fields,
    ...(name === null ? {} : { name }),
    ...(indexMethod === null ? {} : { using: indexMethod }),
    ...(expression === null ? {} : { expression }),
  };
}

// The table the first of `foreignColumns: [users.id]` belongs to; the callback's own parameter
// (`(table) => ...`) stands for the table being declared.
function foreignTable(config: Node | undefined, own: string | null, table: string) {
  const foreign = optionValue(config, "foreignColumns");
  const [first] = foreign?.type === "ArrayExpression" ? foreign.elements : [];
  if (first?.type !== "MemberExpression" || first.object.type !== "Identifier") return null;
  return first.object.name === own ? table : first.object.name;
}

function readConstraints(
  arg: CallExpression["arguments"][number] | undefined,
  table: string,
  source: { readonly program: Program; readonly text: string },
) {
  const { program, text } = source;
  const [own] = isArrow(arg) ? arg.params : [];
  const ownName = own?.type === "Identifier" ? own.name : null;
  return constraintEntries(arg, program).flatMap((entry): Constraint[] => {
    const chain = readChain(entry);
    if (chain === null) return [];
    if (chain.builder === "foreignKey") {
      const [config] = chain.args;
      const listed = optionValue(config, "columns");
      if (listed?.type !== "ArrayExpression") return [];
      const columns = columnNames(listed.elements.filter((e) => e !== null));
      const target = foreignTable(config, ownName, table);
      const { methods } = chain;
      function action(name: string) {
        return stringLiteral(methods.find((m) => m.name === name)?.args[0]);
      }
      return columns.length > 0 && target !== null
        ? [
            {
              kind: "fk",
              columns,
              target,
              onDelete: action("onDelete"),
              onUpdate: action("onUpdate"),
              name: indexName(optionValue(config, "name"), program),
            },
          ]
        : [];
    }
    const type = INDEX_TYPES.get(chain.builder);
    const index = type === undefined ? null : readIndex(chain, type, { program, text });
    return index === null ? [] : [{ kind: "index", index }];
  });
}

// The string values of each TypeScript `enum` the schema declares, by name:
// `enum ProjectRole { OWNER = "owner" }` has `owner`.
function tsEnums(program: Program) {
  return new Map(
    program.body.flatMap((stmt) => {
      const decl = stmt.type === "ExportNamedDeclaration" ? stmt.declaration : stmt;
      if (decl?.type !== "TSEnumDeclaration") return [];
      const values = decl.body.members.flatMap(
        (m) => stringLiteral(m.initializer ?? undefined) ?? [],
      );
      return [[decl.id.name, values] as const];
    }),
  );
}

// The values `pgEnum` is given: an array of strings, or an object of them (a TypeScript enum, or
// an object literal), whose values drizzle-orm takes; written in the schema or named by a
// top-level `const` or `enum`. Empty for a name the schema does not declare (an enum imported
// from a package), and null for anything else.
function enumValues(
  node: Node | undefined,
  program: Program,
  enums: ReadonlyMap<string, readonly string[]>,
  seen: ReadonlySet<string> = new Set(),
): readonly string[] | null {
  const value = node === undefined ? undefined : unwrapExpression(node);
  if (value?.type === "ArrayExpression") {
    return value.elements.flatMap((e) => stringLiteral(e ?? undefined) ?? []);
  }
  if (isObject(value)) {
    return value.properties.flatMap((p) =>
      isPropertyAssignment(p) ? (stringLiteral(p.value) ?? []) : [],
    );
  }
  if (value?.type !== "Identifier" || seen.has(value.name)) return null;
  const declared = enums.get(value.name);
  if (declared !== undefined) return declared;
  const bound = topLevelValue(value.name, program);
  return bound === undefined
    ? []
    : enumValues(bound, program, enums, new Set([...seen, value.name]));
}

// `x as const` and `(x)` are `x`.
function unwrapExpression(node: Node): Node {
  if (node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression") {
    return unwrapExpression(node.expression);
  }
  return node.type === "ParenthesizedExpression" ? unwrapExpression(node.expression) : node;
}

// A database schema: `pgSchema('auth')`, or a top-level variable bound to one (`authSchema`).
function isSchema(node: Node, program: Program) {
  const value = node.type === "Identifier" ? topLevelValue(node.name, program) : node;
  if (!isCall(value)) return false;
  const { callee } = value;
  const builder = callee.type === "MemberExpression" && !callee.computed ? callee.property : callee;
  return builder.type === "Identifier" && builder.name.endsWith("Schema");
}

// Whether a call declares an enum: `pgEnum('role', [...])`, or `authSchema.enum('role', [...])`
// (`pgSchema('auth').enum(...)`) for an enum of a database schema.
function declaresEnum(init: Node | null, program: Program): init is CallExpression {
  if (!isCall(init)) return false;
  const { callee } = init;
  if (callee.type === "Identifier") return callee.name.endsWith("Enum");
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier" &&
    callee.property.name === "enum" &&
    isSchema(callee.object, program)
  );
}

// `export const role = pgEnum('role', ['admin', 'member'])`, or `pgEnum('role', Role)` for a
// TypeScript enum `Role`, or the same declared on a database schema (`authSchema.enum(...)`).
function readEnums(program: Program, source: Parameters<typeof descriptionBefore>[0]) {
  const declared = tsEnums(program);
  return topLevelDeclarations(program).flatMap(({ declarator, start }): SchemaEnum[] => {
    const name = declaratorName(declarator);
    const init = declarator.init;
    if (name === null || !declaresEnum(init, program)) return [];
    const [dbName, given] = init.arguments;
    const values = enumValues(given, program, declared);
    if (values === null) return [];
    const literal = stringLiteral(dbName);
    return [
      {
        name,
        dbName: literal !== null && literal !== name ? literal : null,
        documentation: descriptionBefore(source, start),
        values: values.map((v) => ({ name: v, dbName: null })),
      },
    ];
  });
}

// A column name as drizzle's snake_case casing writes it: `emailVerified` -> `email_verified`.
function toSnakeCase(name: string) {
  const words = name
    .replaceAll(/['\u2019]/gu, "")
    .match(/[\da-z]+|[A-Z]+(?![a-z])|[A-Z][\da-z]+/gu);
  return (words ?? []).map((word) => word.toLowerCase()).join("_");
}

/**
 * The name each table creator gives a table, by the creator's variable:
 * `const createTable = pgTableCreator((name) => \`project1_${name}\`)` makes
 * `createTable("post")` the table `project1_post`. The callback may read the schema's constants
 * (`` `${projectName}_${name}` ``, `siteConfig.name.toLowerCase()`); a callback the reader cannot
 * work out leaves the name as it is given.
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
      if (param?.type !== "Identifier" || body === null) return [];
      return [
        [
          name,
          (table: string) => evaluateString(body, program, new Map([[param.name, table]])),
        ] as const,
      ];
    }),
  );
}

// The database schema a table is built in: `auth` for `pgSchema("auth").table(...)`, and for
// `authSchema.table(...)` with `const authSchema = pgSchema("auth")` (or `mysqlSchema`). Nothing
// for any other builder, `snakeCase.table` among them.
function tableSchema(builder: string, program: Program): { readonly schema?: string } {
  const schema = schemaName(builder, program);
  return schema === null ? {} : { schema };
}

function schemaName(builder: string, program: Program) {
  const owner = /^(.+)\.table(?:\.withRLS)?$/su.exec(builder)?.[1];
  if (owner === undefined) return null;
  const inline = /^(?:[\w$]+\.)?[\w$]*Schema\((['"`])([^'"`]+)\1\)$/u.exec(owner);
  if (inline !== null) return inline[2] ?? null;
  const value = /^[\w$]+$/u.test(owner) ? topLevelValue(owner, program) : undefined;
  if (!isCall(value) || value.callee.type !== "Identifier") return null;
  return value.callee.name.endsWith("Schema") ? stringLiteral(value.arguments[0]) : null;
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
  const foreignKeys = new Set(
    merged.flatMap((r) => (r.to.fields ?? [r.to.field]).map((field) => `${r.to.model}.${field}`)),
  );
  const actions = new Map<string, KeyActions>();

  const creators = tableCreators(program);

  const models = tableCalls(program, text).flatMap(({ varName, callee, builder, args, start }) => {
    const columns = args[1];
    // `snakeCase.table(...)`, or an alias of it, names a column it is not given a name for in
    // snake_case.
    const snakeCase = /(?:^|\.)snakeCase\.table\b/u.test(builder);
    if (!isObject(columns) && !isArrow(columns) && columns?.type !== "Identifier") return [];
    const constraints = readConstraints(args[2], varName, { program, text });
    for (const c of constraints) {
      if (c.kind === "fk") actions.set(keyOf(varName, c.columns, c.target), c);
    }
    const indexes = constraints.flatMap((c) => (c.kind === "index" ? [c.index] : []));
    const compositeKey = indexes.find((i) => i.type === "id")?.fields ?? null;

    const fields = columnProperties(columns, program).flatMap((prop): SchemaField[] => {
      if (prop.computed || prop.key.type !== "Identifier") return [];
      const name = prop.key.name;
      const chain = columnChain(prop.value, program);
      if (chain === null) return [];
      const { methods } = chain;
      function has(method: string) {
        return methods.some((m) => m.name === method);
      }
      const references = chain.methods.find((m) => m.name === "references");
      const target = references ? referencedTable(references.args[0]) : null;
      // A key declared again as a `foreignKey()` constraint keeps the constraint's name and actions.
      if (references && target !== null && !actions.has(keyOf(varName, [name], target))) {
        actions.set(keyOf(varName, [name], target), {
          ...referentialActions(references.args[1]),
          name: null,
        });
      }
      const dbName = stringLiteral(chain.args[0]) ?? (snakeCase ? toSnakeCase(name) : name);
      const isId = has("primaryKey");
      const withTimezone = chain.args.some(asksForTimezone);
      return [
        {
          name,
          dbName: dbName !== name ? dbName : null,
          kind: enumNames.has(chain.builder) ? "enum" : "scalar",
          type: columnType(chain, program),
          isList: has("array"),
          isRequired: isId || has("notNull"),
          isId,
          isUnique: has("unique"),
          isForeignKey: references !== undefined || foreignKeys.has(`${varName}.${name}`),
          documentation: descriptionBefore(source, prop.start),
          attributes: fieldNotes(chain.methods, text),
          ...(withTimezone ? { withTimezone: true as const } : {}),
          ...increments(chain.methods),
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
        ...tableSchema(builder, program),
        documentation: descriptionBefore(source, start),
        primaryKey: compositeKey,
        fields,
        indexes: indexes.filter((i) => i.type !== "id" || i.fields.length > 1),
      } satisfies SchemaModel,
    ];
  });

  const relations = merged.map((r): SchemaRelation => {
    const key = actions.get(keyOf(r.to.model, r.to.fields ?? [r.to.field], r.from.model));
    return {
      origin: r.origin,
      name: null,
      ...(key?.name === undefined || key.name === null ? {} : { constraintName: key.name }),
      onDelete: key?.onDelete ?? null,
      onUpdate: key?.onUpdate ?? null,
      from: r.from,
      to: r.to,
    };
  });

  return { models, relations, enums };
}
