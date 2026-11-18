import type {
  ArrowFunctionExpression,
  CallExpression,
  Expression,
  Node,
  ObjectProperty,
  Program,
} from "oxc-parser";
import {
  arrowObject,
  columnExpressions,
  columnProperties,
  columnText,
  descriptionBefore,
  callsIn,
  fallbackValue,
  declaratorName,
  helperCall,
  topLevelDeclarations,
  isArrow,
  isCall,
  isObject,
  isPropertyAssignment,
  parseSource,
  textOf,
  unwrapParens,
} from "./ast.js";

// The builder at the root of a column chain: `varchar` in `varchar("id").notNull()`, and in the
// callback form `t.varchar().notNull()` as well.
function baseBuilderName(expr: Expression, text: string): string {
  if (expr.type === "Identifier") return textOf(text, expr);
  if (expr.type !== "CallExpression") return "";
  const { callee } = expr;
  if (callee.type === "Identifier") return callee.name;
  // `customType({ ... })("token")` is built with `customType`.
  if (isCall(callee)) return baseBuilderName(callee, text);
  if (callee.type !== "MemberExpression" || callee.computed) return "";
  if (isCall(callee.object)) return baseBuilderName(callee.object, text);
  return callee.property.type === "Identifier" ? callee.property.name : "";
}

// The call that starts a column chain: `timestamp({ withTimezone: true })` in
// `timestamp({ withTimezone: true }).notNull()`.
function builderCall(expr: CallExpression): CallExpression {
  const { callee } = expr;
  return callee.type === "MemberExpression" && isCall(callee.object)
    ? builderCall(callee.object)
    : expr;
}

// Whether the builder's config says `withTimezone: true`, as in
// `timestamp({ withTimezone: true })` or `timestamp('created_at', { withTimezone: true })`.
/**
 * Whether one argument of a column builder is an options object that sets `withTimezone: true`.
 */
export function asksForTimezone(arg: Node) {
  return (
    isObject(arg) &&
    arg.properties.some(
      (p) =>
        isPropertyAssignment(p) &&
        p.key.type === "Identifier" &&
        p.key.name === "withTimezone" &&
        p.value.type === "Literal" &&
        p.value.value === true,
    )
  );
}

function hasTimezone(expr: CallExpression) {
  return builderCall(expr).arguments.some(asksForTimezone);
}

function extractKeyType(initText: string) {
  if (initText.includes(".primaryKey()")) return "PK" as const;
  if (initText.includes(".references(")) return "FK" as const;
  return null;
}

// The name of a `key: value` property when the key is a plain identifier.
function identifierKey(prop: ObjectProperty) {
  return !prop.computed && prop.key.type === "Identifier" ? prop.key.name : null;
}

// Reads the `() => table.col` target from a `.references()` call via the AST so
// the second argument (a `{ onDelete, onUpdate }` config object) never affects
// extraction — a text-based match on `.references(... )` would lose the relation
// whenever a referential-action config is present.
function extractReferenceInfo(initExprs: readonly Expression[]) {
  const referencesCall = initExprs
    .flatMap(callsIn)
    .find(
      (call) =>
        call.callee.type === "MemberExpression" &&
        !call.callee.computed &&
        call.callee.property.type === "Identifier" &&
        call.callee.property.name === "references",
    );
  if (!referencesCall) return null;
  const [target] = referencesCall.arguments;
  if (!isArrow(target)) return null;
  const body = target.body;
  if (body.type !== "MemberExpression" || body.computed) return null;
  if (body.object.type !== "Identifier" || body.property.type !== "Identifier") return null;
  return {
    referencedTable: body.object.name,
    referencedField: body.property.name,
  };
}

// A primary key column is NOT NULL whether or not `.notNull()` says so.
function isFieldRequired(initText: string) {
  return initText.includes(".notNull()") || initText.includes(".primaryKey()");
}

function extractFieldInfo(
  prop: ObjectProperty,
  source: Parameters<typeof descriptionBefore>[0],
  program: Program,
) {
  const { text } = source;
  const fieldName = identifierKey(prop);
  if (fieldName === null) return null;

  const initExpr = prop.value;
  if (!isCall(initExpr)) return null;

  // A column a helper function builds is the builder the helper calls.
  const last = columnExpressions(initExpr, program).at(-1);
  const builderExpr = isCall(last) ? last : initExpr;
  const fieldType = baseBuilderName(builderExpr, text);
  const initText = columnText(initExpr, program, text);
  const description = descriptionBefore(source, prop.start);
  const keyType = extractKeyType(initText);

  return {
    name: fieldName,
    type: fieldType,
    keyType,
    description,
    // Only set when written, so a column without a time zone reads as before.
    ...(hasTimezone(builderExpr) ? { withTimezone: true as const } : {}),
  };
}

function extractRelationFromField(
  prop: ObjectProperty,
  tableName: string,
  text: string,
  program: Program,
) {
  const fieldName = identifierKey(prop);
  if (fieldName === null) return null;

  const initExpr = prop.value;
  if (!isCall(initExpr)) return null;

  // A helper function's `.references()` and `.notNull()` count as the column's own.
  const initText = columnText(initExpr, program, text);
  if (!initText.includes(".references(")) return null;

  const refInfo = extractReferenceInfo(columnExpressions(initExpr, program));
  if (!refInfo) return null;

  const isRequired = isFieldRequired(initText);

  return {
    fromModel: refInfo.referencedTable,
    toModel: tableName,
    fromField: refInfo.referencedField,
    toField: fieldName,
    fromFields: [refInfo.referencedField],
    toFields: [fieldName],
    isRequired,
    enforced: true,
  };
}

/**
 * The entries of a table's third argument: `(t) => [index(...)]` or the older
 * `(t) => ({ name: index(...) })`. An array a top-level function returns,
 * `(t) => genericIndexes(t, "books_genre")`, is read with its parameters bound to the call's
 * arguments, and so is one spread into the array.
 */
export function constraintEntries(
  arg: CallExpression["arguments"][number] | undefined,
  program?: Program,
) {
  if (!isArrow(arg)) return [];
  const body = arg.body.type === "BlockStatement" ? null : unwrapParens(arg.body);
  const listed = body === null ? null : arrayEntries(body, program);
  if (listed !== null) return listed;
  const obj = arrowObject(arg);
  return obj ? obj.properties.filter(isPropertyAssignment).map((p) => p.value) : [];
}

// The elements of an array of constraints, or of the array a helper call returns. Null for
// anything else.
function arrayEntries(
  node: Expression,
  program: Program | undefined,
  depth = 0,
): Expression[] | null {
  const expr = unwrapParens(node);
  if (expr.type === "ArrayExpression") {
    return expr.elements.flatMap((e) => {
      if (e === null) return [];
      if (e.type !== "SpreadElement") return [e];
      return arrayEntries(e.argument, program, depth + 1) ?? [];
    });
  }
  if (!isCall(expr) || program === undefined || depth > 8) return null;
  const helper = helperCall(expr, program);
  return helper === null ? null : arrayEntries(helper.returned, program, depth + 1);
}

// The name of an arrow function's first parameter: `table` in `(table) => ...`.
// The value of one key of a relation's options object, `{ from: ..., to: ... }`.
function optionOf(config: Node | undefined, key: string) {
  return isObject(config)
    ? config.properties.filter(isPropertyAssignment).find((p) => identifierKey(p) === key)?.value
    : undefined;
}

function arrowParameter(arrow: ArrowFunctionExpression) {
  const [first] = arrow.params;
  return first?.type === "Identifier" ? first.name : null;
}

// The `table.column` pairs of an array: `[t.documentId, t.documentCreatedAt]`. Null when an
// element is anything else, so a key the reader cannot follow is left out whole.
function memberColumns(node: Node | undefined) {
  if (node?.type !== "ArrayExpression" || node.elements.length === 0) return null;
  const pairs = node.elements.map((element) =>
    element?.type === "MemberExpression" &&
    !element.computed &&
    element.object.type === "Identifier" &&
    element.property.type === "Identifier"
      ? { table: element.object.name, column: element.property.name }
      : null,
  );
  return pairs.every((p) => p !== null) ? pairs.filter((p) => p !== null) : null;
}

// The `foreignKey({ ... })` call at the root of a constraint, under its `.onDelete()` and the like;
// `d.foreignKey({ ... })` of a namespace import too.
function foreignKeyCall(entry: Expression): CallExpression | null {
  const expr = unwrapParens(entry);
  if (!isCall(expr)) return null;
  const { callee } = expr;
  if (callee.type === "Identifier") return callee.name === "foreignKey" ? expr : null;
  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "Identifier" &&
    callee.property.type === "Identifier"
  ) {
    return callee.property.name === "foreignKey" ? expr : null;
  }
  return callee.type === "MemberExpression" && isCall(callee.object)
    ? foreignKeyCall(callee.object)
    : null;
}

// Pattern: foreignKey({ columns: [t.a, t.b], foreignColumns: [other.x, other.y] }), one column or
// several (a composite key, drawn by its first pair and written whole where the output can).
function extractRelationsFromForeignKeyConstraints(
  tableName: string,
  constraintArg: CallExpression["arguments"][number],
  required: ReadonlyMap<string, boolean>,
  program: Program,
) {
  // The callback's own parameter (`(table) => ...`) stands for the table being declared, so a
  // `foreignColumns: [table.id]` is a key to the table itself.
  const own = isArrow(constraintArg) ? arrowParameter(constraintArg) : null;
  return constraintEntries(constraintArg, program).flatMap((entry) => {
    const call = foreignKeyCall(entry);
    if (call === null) return [];
    const [config] = call.arguments;
    const columns = memberColumns(optionOf(config, "columns"));
    const foreign = memberColumns(optionOf(config, "foreignColumns"));
    const [column] = columns ?? [];
    const [foreignColumn] = foreign ?? [];
    if (column === undefined || foreignColumn === undefined) return [];
    if (columns?.length !== foreign?.length) return [];
    const target = foreignColumn.table === own ? tableName : foreignColumn.table;
    const toFields = (columns ?? []).map((c) => c.column);
    return [
      {
        fromModel: target,
        toModel: tableName,
        fromField: foreignColumn.column,
        toField: column.column,
        fromFields: (foreign ?? []).map((c) => c.column),
        toFields,
        isRequired: toFields.every((field) => required.get(`${tableName}.${field}`) ?? false),
        enforced: true,
      },
    ];
  });
}

function isFkLikeName(name: string) {
  const lower = name.toLowerCase();
  return (lower.endsWith("id") && lower !== "id") || lower.endsWith("_id");
}

// Whether each `table.column` is `.notNull()`, so a relation that only `defineRelations` declares
// still knows if its child side may be empty.
function requiredColumns(program: Program, text: string) {
  return new Map(
    tableCalls(program, text).flatMap(({ varName, args }) => {
      return columnProperties(args[1], program).flatMap((prop) => {
        const fieldName = identifierKey(prop);
        return fieldName === null
          ? []
          : [
              [
                `${varName}.${fieldName}`,
                isFieldRequired(columnText(prop.value, program, text)),
              ] as const,
            ];
      });
    }),
  );
}

// The column sets that identify a row of each table: a `.primaryKey()` or `.unique()` column, and
// the columns of a `primaryKey()`, `unique()` or `uniqueIndex()` constraint.
function keyedColumns(program: Program, text: string) {
  return new Map(
    tableCalls(program, text).map(({ varName, args }) => {
      const single = columnProperties(args[1], program).flatMap((prop) => {
        const fieldName = identifierKey(prop);
        const initText = columnText(prop.value, program, text);
        return fieldName !== null && /\.(primaryKey|unique)\(/u.test(initText) ? [[fieldName]] : [];
      });
      const constraints = constraintEntries(args[2], program).flatMap((entry) => {
        // String literals (an index name) are left out, so only `t.col` reads as a column.
        const entryText = textOf(text, entry).replaceAll(/(['"`])(?:(?!\1).)*\1/gu, "");
        if (!/^\s*(primaryKey|unique|uniqueIndex)\s*\(/u.test(entryText)) return [];
        return [[...entryText.matchAll(/\b[\w$]+\.([\w$]+)\b/gu)].map((m) => m[1])];
      });
      return [varName, [...single, ...constraints]] as const;
    }),
  );
}

const RELATION_BUILDERS = new Set(["defineRelations", "defineRelationsPart"]);

/** A column as the relations name it: `r.posts.ownerId`. */
type ColumnRef = { readonly table: string; readonly column: string };

// The table key a column is reached through: `posts` in `r.posts` or in `posts`.
function ownerKey(owner: Node) {
  if (owner.type === "Identifier") return owner.name;
  if (owner.type !== "MemberExpression" || owner.computed) return null;
  return owner.property.type === "Identifier" ? owner.property.name : null;
}

// `r.posts.ownerId` (or `posts.ownerId`), with the table under the name `table` maps its key to.
function columnRef(node: Node, table: (key: string) => string): ColumnRef | null {
  if (node.type !== "MemberExpression" || node.computed || node.property.type !== "Identifier") {
    return null;
  }
  const key = ownerKey(node.object);
  return key === null ? null : { table: table(key), column: node.property.name };
}

// One end of a relation, `from` or `to`: a column or an array of them (a composite key), each
// maybe `.through(r.junction.column)` for a many-to-many kept in a junction table.
function relationEnd(node: Node, table: (key: string) => string) {
  const items = node.type === "ArrayExpression" ? node.elements : [node];
  const parsed = items.map((item) => {
    if (item === null || item.type === "SpreadElement") return null;
    if (
      isCall(item) &&
      item.callee.type === "MemberExpression" &&
      !item.callee.computed &&
      item.callee.property.type === "Identifier" &&
      item.callee.property.name === "through"
    ) {
      const column = columnRef(item.callee.object, table);
      const [junction] = item.arguments;
      const through = junction ? columnRef(junction, table) : null;
      return column && through ? { column, through } : null;
    }
    const column = columnRef(item, table);
    return column ? { column, through: null } : null;
  });
  if (parsed.length === 0) return null;
  const ends = parsed.filter((p): p is NonNullable<typeof p> => p !== null);
  if (ends.length !== parsed.length) return null;
  return {
    columns: ends.map((e) => e.column),
    through: ends.flatMap((e) => (e.through === null ? [] : [e.through])),
  };
}

// The tables a `defineRelations` call is given, each key with the export it names: an object
// literal (`{ users, author: users }`), or a `schema` namespace, which has every exported table.
function relationTables(arg: Node | undefined, tableNames: readonly string[]) {
  const every = tableNames.map((name) => [name, name] as const);
  if (!isObject(arg)) return new Map(every);
  return new Map(
    arg.properties.flatMap((prop) => {
      if (prop.type === "SpreadElement") return every;
      if (prop.computed || prop.key.type !== "Identifier") return [];
      const value = prop.value.type === "Identifier" ? prop.value.name : prop.key.name;
      return [[prop.key.name, value] as const];
    }),
  );
}

/**
 * Every `defineRelations` and `defineRelationsPart` export, whatever it is named: the tables it is
 * given (by the exports that hold them) and each relation it declares, as `r.one.X(...)` or
 * `r.many.X(...)` on a table. `from` and `to` are null for a relation that names no columns, the
 * reverse side of a pair the other table declares.
 */
function relationDefinitions(program: Program, text: string) {
  const tableNames = tableCalls(program, text).map(({ varName }) => varName);
  return topLevelDeclarations(program).flatMap(({ declarator }) => {
    const exportName = declaratorName(declarator);
    const init = declarator.init;
    if (exportName === null || !isCall(init) || init.callee.type !== "Identifier") return [];
    if (!RELATION_BUILDERS.has(init.callee.name)) return [];
    const [tablesArg, define] = init.arguments;
    const tables = relationTables(tablesArg, tableNames);
    function table(key: string) {
      return tables.get(key) ?? key;
    }
    const body = isArrow(define) ? arrowObject(define) : null;
    const relations = (body?.properties ?? []).filter(isPropertyAssignment).flatMap((tableProp) => {
      const source = identifierKey(tableProp);
      const declared = unwrapParens(tableProp.value);
      if (source === null || !isObject(declared)) return [];
      return declared.properties.filter(isPropertyAssignment).flatMap((prop) => {
        const name = identifierKey(prop);
        const call = unwrapParens(prop.value);
        if (name === null || !isCall(call)) return [];
        const builder = textOf(text, call.callee).match(/^(?:[\w$]+\.)?(one|many)\.([\w$]+)$/u);
        if (builder === null) return [];
        const [config] = call.arguments;
        const from = optionOf(config, "from");
        const to = optionOf(config, "to");
        const optional = optionOf(config, "optional");
        return [
          {
            table: table(source),
            name,
            kind: builder[1] === "one" ? ("one" as const) : ("many" as const),
            target: table(builder[2] ?? ""),
            from: from ? relationEnd(from, table) : null,
            to: to ? relationEnd(to, table) : null,
            optional:
              optional?.type === "Literal" && typeof optional.value === "boolean"
                ? optional.value
                : null,
          },
        ];
      });
    });
    return [
      {
        name: exportName,
        part: init.callee.name === "defineRelationsPart",
        tables: [...new Set(tables.values())],
        relations,
      },
    ];
  });
}

type Relation = ReturnType<typeof extractRelationFromField> & {};

// Pattern: defineRelations(tables, (r) => ({ table: { name: r.one.other({ from, to }) } }))
// A relation found here is not a database constraint (`enforced: false`); when a foreign key
// backs the same pair, the foreign key's entry is kept instead. Composite `from`/`to` keys are
// drawn by their first column pair, as the edge is a single column to a single column.
function extractRelationsFromDefinitions(
  program: Program,
  text: string,
  foreignKeys: readonly Relation[],
  required: ReturnType<typeof requiredColumns>,
  keys: ReturnType<typeof keyedColumns>,
) {
  const references = new Set(foreignKeys.map((r) => `${r.toModel}.${r.toField}->${r.fromModel}`));
  // Whether a column of `child` is a foreign key to the table of `parent`.
  function pointsAt(child: readonly ColumnRef[], parent: readonly ColumnRef[]) {
    const [head] = parent;
    return (
      head !== undefined &&
      child.some((c) => references.has(`${c.table}.${c.column}->${head.table}`))
    );
  }
  function isKeyed(columns: readonly ColumnRef[]) {
    const [head] = columns;
    if (head === undefined) return false;
    return (keys.get(head.table) ?? []).some(
      // oxlint-disable-next-line custom/no-lookup-in-loop -- a key holds a few columns
      (key) => key.length === columns.length && columns.every((c) => key.includes(c.column)),
    );
  }
  // Which end holds the key of a `one`: the end whose column is a foreign key to the other; else
  // the end that is not the other's primary key or unique; else the end with an `...Id` name;
  // else the source.
  function targetHoldsKey(from: readonly ColumnRef[], to: readonly ColumnRef[]) {
    if (pointsAt(to, from)) return true;
    if (pointsAt(from, to)) return false;
    const fromKeyed = isKeyed(from);
    if (fromKeyed !== isKeyed(to)) return fromKeyed;
    return !isFkLikeName(from[0]?.column ?? "") && isFkLikeName(to[0]?.column ?? "");
  }
  // An end names at least one column (relationEnd gives null otherwise), so an edge is drawn
  // between the first of each; an end with none draws nothing.
  function edge(parent: readonly ColumnRef[], child: readonly ColumnRef[], mustExist: boolean) {
    const [p] = parent;
    const [c] = child;
    if (p === undefined || c === undefined) return [];
    return [
      {
        fromModel: p.table,
        toModel: c.table,
        fromField: p.column,
        toField: c.column,
        fromFields: [p.column],
        toFields: [c.column],
        isRequired: mustExist || (required.get(`${c.table}.${c.column}`) ?? true),
        enforced: false,
      },
    ];
  }

  return relationDefinitions(program, text).flatMap(({ relations }) =>
    relations.flatMap((relation) => {
      const { from, to } = relation;
      // The reverse side of a pair names no columns; the other table's side does.
      if (from === null || to === null) return [];
      // A many-to-many through a junction table is a key from each end into the junction.
      if (from.through.length > 0 && to.through.length > 0) {
        return [...edge(from.columns, from.through, false), ...edge(to.columns, to.through, false)];
      }
      if (relation.kind === "many") return edge(from.columns, to.columns, false);
      return targetHoldsKey(from.columns, to.columns)
        ? edge(from.columns, to.columns, false)
        : edge(to.columns, from.columns, relation.optional === false);
    }),
  );
}

// The relation kind each name an arrow's `({ one, many })` parameter binds stands for, and the
// name of a plain parameter (`(r) => ({ user: r.one(...) })`).
function relationHelpers(arrow: ArrowFunctionExpression) {
  const [param] = arrow.params;
  if (param?.type === "Identifier") return { object: param.name, names: new Map<string, string>() };
  if (param?.type !== "ObjectPattern") return { object: null, names: new Map<string, string>() };
  return {
    object: null,
    names: new Map(
      param.properties.flatMap((p) =>
        p.type === "Property" &&
        !p.computed &&
        p.key.type === "Identifier" &&
        p.value.type === "Identifier"
          ? [[p.value.name, p.key.name] as const]
          : [],
      ),
    ),
  };
}

// Which helper a relation calls: `one` for `one(users, ...)` or `r.one(users, ...)`.
function relationKind(
  callee: CallExpression["callee"],
  helpers: ReturnType<typeof relationHelpers>,
) {
  if (callee.type === "Identifier") return helpers.names.get(callee.name);
  if (callee.type !== "MemberExpression" || callee.computed) return undefined;
  const ownObject = callee.object.type === "Identifier" && callee.object.name === helpers.object;
  return ownObject && callee.property.type === "Identifier" ? callee.property.name : undefined;
}

// Pattern: relations(sessions, ({ one }) => ({ user: one(users, { fields: [sessions.userId],
// references: [users.id] }) })), the relational API before `defineRelations`. As with
// `defineRelations`, a relation found here is not a database constraint (`enforced: false`). A
// `many` names no columns; the `one` on the other table does.
function extractV1Relations(program: Program, required: ReadonlyMap<string, boolean>) {
  return topLevelDeclarations(program).flatMap(({ declarator }) => {
    const init = declarator.init;
    if (!isCall(init) || init.callee.type !== "Identifier" || init.callee.name !== "relations") {
      return [];
    }
    const [, define] = init.arguments;
    const body = isArrow(define) ? arrowObject(define) : null;
    if (!isArrow(define) || body === null) return [];
    const helpers = relationHelpers(define);
    return body.properties.filter(isPropertyAssignment).flatMap((prop) => {
      const call = unwrapParens(prop.value);
      if (!isCall(call)) return [];
      if (relationKind(call.callee, helpers) !== "one") return [];
      const config = call.arguments[1];
      const fields = memberColumns(optionOf(config, "fields"));
      const references = memberColumns(optionOf(config, "references"));
      const [child] = fields ?? [];
      const [parent] = references ?? [];
      if (child === undefined || parent === undefined || fields?.length !== references?.length) {
        return [];
      }
      const toFields = (fields ?? []).map((c) => c.column);
      return [
        {
          fromModel: parent.table,
          toModel: child.table,
          fromField: parent.column,
          toField: child.column,
          fromFields: (references ?? []).map((c) => c.column),
          toFields,
          isRequired: toFields.every((f) => required.get(`${child.table}.${f}`) ?? false),
          enforced: false,
        },
      ];
    });
  });
}

/**
 * Whether a callee builds a table: `pgTable`, `sqliteTable`, `mysqlTable`, ..., `pgTable.withRLS`,
 * and the `.table` of a casing or a schema (`snakeCase.table`, `camelCase.table`,
 * `pgSchema("auth").table`, `authSchema.table`); never `defineRelations`, whatever it is named.
 */
function isTableBuilder(callee: string) {
  return /(?:Table|\.table)(?:\.withRLS)?$/u.test(callee.replaceAll(/\s+/gu, ""));
}

/**
 * The builder each top-level alias stands for: `const table = snakeCase.table` makes `table` the
 * builder `snakeCase.table`, and `const createTable = pgTableCreator(...)` makes `createTable` a
 * table builder whatever it is named.
 */
function builderAliases(program: Program, text: string) {
  const aliases = new Map<string, string>();
  for (const { declarator } of topLevelDeclarations(program)) {
    const name = declaratorName(declarator);
    const init = declarator.init ? unwrapParens(declarator.init) : null;
    if (name === null || init === null || aliases.has(name)) continue;
    if (init.type === "Identifier" || (init.type === "MemberExpression" && !init.computed)) {
      aliases.set(name, resolveBuilder(textOf(text, init).replaceAll(/\s+/gu, ""), aliases));
    } else if (
      isCall(init) &&
      init.callee.type === "Identifier" &&
      init.callee.name.endsWith("TableCreator")
    ) {
      aliases.set(name, init.callee.name.replace(/Creator$/u, ""));
    }
  }
  return aliases;
}

// A callee with its leading alias replaced by the builder it stands for: `table` -> `snakeCase.table`,
// `table.withRLS` -> `pgTable.withRLS`.
function resolveBuilder(callee: string, aliases: ReadonlyMap<string, string>) {
  const match = /^([\w$]+)(.*)$/su.exec(callee);
  const alias = match?.[1] === undefined ? undefined : aliases.get(match[1]);
  return alias === undefined || match === null ? callee : `${alias}${match[2] ?? ""}`;
}

/**
 * The `xxxTable("name", { ...columns }, constraints)` calls at the top level or in a top-level
 * function (`schema.users ?? sqliteTable(...)` too), exported in place or in an
 * `export { ... }` list, with the variable they are bound to and the builder they call, aliases
 * resolved (`snakeCase.table` for `const table = snakeCase.table; table(...)`).
 */
export function tableCalls(program: Program, text: string) {
  const aliases = builderAliases(program, text);
  return topLevelDeclarations(program).flatMap(({ declarator, start, end }) => {
    const varName = declaratorName(declarator);
    if (varName === null) return [];

    const init = declarator.init ? fallbackValue(declarator.init) : null;
    const call = isCall(init) ? tableCall(init, text, aliases) : null;
    if (call === null) return [];

    return [{ varName, callee: call.callee, builder: call.builder, args: call.args, start, end }];
  });
}

// The table builder call in a declaration's value, under any method chained on the table it
// returns: `pgTable("user", {...})` in `pgTable("user", {...}).enableRLS()`.
function tableCall(
  init: CallExpression,
  text: string,
  aliases: ReadonlyMap<string, string>,
): { callee: CallExpression["callee"]; builder: string; args: CallExpression["arguments"] } | null {
  const builder = resolveBuilder(textOf(text, init.callee).replaceAll(/\s+/gu, ""), aliases);
  if (isTableBuilder(builder)) return { callee: init.callee, builder, args: init.arguments };
  const { callee } = init;
  return callee.type === "MemberExpression" && isCall(callee.object)
    ? tableCall(callee.object, text, aliases)
    : null;
}

/** Each table of the schema with its columns: their types, keys and descriptions. */
export function parseTableInfo(code: readonly string[]) {
  const source = parseSource(code);
  const { program, text } = source;

  return tableCalls(program, text).flatMap(({ varName, args, start }) => {
    if (!isObject(args[1]) && !isArrow(args[1]) && args[1]?.type !== "Identifier") return [];

    const fields = columnProperties(args[1], program)
      .map((prop) => extractFieldInfo(prop, source, program))
      .filter((f): f is NonNullable<typeof f> => f !== null);

    return [{ name: varName, description: descriptionBefore(source, start), fields }];
  });
}

/**
 * Sources scanned: .references() calls, foreignKey() constraints, defineRelations() and
 * defineRelationsPart() exports, and the older relations() exports. A pair found more than once keeps its first entry, so a foreign
 * key wins over a relation only `defineRelations` declares.
 */
export function extractRelationsFromSchema(code: readonly string[]) {
  const { program, text } = parseSource(code);
  const required = requiredColumns(program, text);

  const tableRelations = tableCalls(program, text).flatMap(({ varName, args }) => {
    const constraintArg = args[2];

    // Second argument: the columns, spreads of helper objects included
    const fieldRelations = columnProperties(args[1], program)
      .map((prop) => extractRelationFromField(prop, varName, text, program))
      .filter((r): r is NonNullable<typeof r> => r !== null);

    // Third argument: constraints (foreignKey, indexes, etc.)
    const fkRelations = constraintArg
      ? extractRelationsFromForeignKeyConstraints(varName, constraintArg, required, program)
      : [];

    return [...fieldRelations, ...fkRelations];
  });

  const keys = keyedColumns(program, text);
  const allRelations = [
    ...tableRelations,
    ...extractRelationsFromDefinitions(program, text, tableRelations, required, keys),
    ...extractV1Relations(program, required),
  ];

  const seen = new Set<string>();
  return allRelations
    .filter((r) => {
      const key = `${r.fromModel}.${r.fromFields.join(",")}->${r.toModel}.${r.toFields.join(",")}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map(({ fromFields, toFields, ...r }) => ({
      ...r,
      // Every column of a composite key; a key of one column has them as its fields already.
      ...(toFields.length > 1 ? { fromFields, toFields } : {}),
      // A child column that is a key of its own (`.primaryKey()`, `.unique()`, a one-column
      // `unique()` constraint) holds at most one row per parent: a one-to-one. So do the
      // columns of a composite key that are, together, a key of their table.
      isUnique: (keys.get(r.toModel) ?? []).some((k) => {
        const key = new Set(k);
        return key.size === toFields.length && toFields.every((f) => key.has(f));
      }),
    }));
}

/**
 * The relations `defineRelations` and `defineRelationsPart` declare, as
 * `db.query.*.findMany({ with })` names them: the table, the name it gives the relation, and the
 * table `r.one` or `r.many` points at. A table's relations may be split over a main definition
 * and its parts; each name counts once.
 *
 * @param code - the schema's source lines, without their imports
 * @returns one entry per table and relation name
 */
export function relationFields(code: readonly string[]) {
  const { program, text } = parseSource(code);
  const all = relationDefinitions(program, text).flatMap(({ relations }) =>
    relations.map(({ table, name, target }) => ({ table, name, target })),
  );
  // The first of each table and name, in the order they are declared.
  const byName = Map.groupBy(all, (field) => JSON.stringify([field.table, field.name]));
  return [...byName.values()].flatMap((same) => same.slice(0, 1));
}
