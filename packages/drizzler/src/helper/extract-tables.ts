import type { CallExpression, Expression, Node, ObjectProperty, Program } from "oxc-parser";
import {
  arrowObject,
  columnProperties,
  descriptionBefore,
  callsIn,
  declaratorName,
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
  if (callee.type !== "MemberExpression" || callee.computed) return "";
  if (isCall(callee.object)) return baseBuilderName(callee.object, text);
  return callee.property.type === "Identifier" ? callee.property.name : "";
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
function extractReferenceInfo(initExpr: CallExpression) {
  const referencesCall = callsIn(initExpr).find(
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

function extractFieldInfo(prop: ObjectProperty, source: Parameters<typeof descriptionBefore>[0]) {
  const { text } = source;
  const fieldName = identifierKey(prop);
  if (fieldName === null) return null;

  const initExpr = prop.value;
  if (!isCall(initExpr)) return null;

  const fieldType = baseBuilderName(initExpr, text);
  const initText = textOf(text, initExpr);
  const description = descriptionBefore(source, prop.start);
  const keyType = extractKeyType(initText);

  return {
    name: fieldName,
    type: fieldType,
    keyType,
    description,
  };
}

function extractRelationFromField(prop: ObjectProperty, tableName: string, text: string) {
  const fieldName = identifierKey(prop);
  if (fieldName === null) return null;

  const initExpr = prop.value;
  if (!isCall(initExpr)) return null;

  const initText = textOf(text, initExpr);
  if (!initText.includes(".references(")) return null;

  const refInfo = extractReferenceInfo(initExpr);
  if (!refInfo) return null;

  const isRequired = isFieldRequired(initText);

  return {
    fromModel: refInfo.referencedTable,
    toModel: tableName,
    fromField: refInfo.referencedField,
    toField: fieldName,
    isRequired,
    enforced: true,
  };
}

/**
 * The entries of a table's third argument: `(t) => [index(...)]` or the older
 * `(t) => ({ name: index(...) })`.
 */
export function constraintEntries(arg: CallExpression["arguments"][number] | undefined) {
  if (!isArrow(arg)) return [];
  const body = arg.body.type === "BlockStatement" ? null : unwrapParens(arg.body);
  if (body?.type === "ArrayExpression") {
    return body.elements.filter((e): e is Expression => e !== null && e.type !== "SpreadElement");
  }
  const obj = arrowObject(arg);
  return obj ? obj.properties.filter(isPropertyAssignment).map((p) => p.value) : [];
}

// Pattern: foreignKey({ columns: [Table.field], foreignColumns: [OtherTable.field] })
function extractRelationsFromForeignKeyConstraints(
  tableName: string,
  constraintArg: CallExpression["arguments"][number],
  text: string,
) {
  return constraintEntries(constraintArg).flatMap((entry) => {
    const constraintText = textOf(text, entry);
    if (!constraintText.includes("foreignKey(")) return [];

    const columnsMatch = constraintText.match(/columns:\s*\[\s*(\w+)\.(\w+)\s*\]/);
    const foreignColumnsMatch = constraintText.match(/foreignColumns:\s*\[\s*(\w+)\.(\w+)\s*\]/);
    if (!columnsMatch || !foreignColumnsMatch) return [];

    return [
      {
        fromModel: foreignColumnsMatch[1],
        toModel: tableName,
        fromField: foreignColumnsMatch[2],
        toField: columnsMatch[2],
        // For foreignKey constraints, we assume required unless explicitly nullable
        isRequired: !constraintText.includes(".nullable()"),
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
          : [[`${varName}.${fieldName}`, isFieldRequired(textOf(text, prop.value))] as const];
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
        const initText = textOf(text, prop.value);
        return fieldName !== null && /\.(primaryKey|unique)\(/u.test(initText) ? [[fieldName]] : [];
      });
      const constraints = constraintEntries(args[2]).flatMap((entry) => {
        // String literals (an index name) are left out, so only `t.col` reads as a column.
        const entryText = textOf(text, entry).replace(/(['"`])(?:(?!\1).)*\1/gu, "");
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
export function relationDefinitions(program: Program, text: string) {
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
        function option(key: string) {
          return isObject(config)
            ? config.properties.filter(isPropertyAssignment).find((p) => identifierKey(p) === key)
                ?.value
            : undefined;
        }
        const from = option("from");
        const to = option("to");
        const optional = option("optional");
        return [
          {
            table: table(source),
            name,
            kind: builder[1] === "one" ? ("one" as const) : ("many" as const),
            target: table(builder[2]),
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
) {
  const required = requiredColumns(program, text);
  const keys = keyedColumns(program, text);
  const references = new Set(foreignKeys.map((r) => `${r.toModel}.${r.toField}->${r.fromModel}`));
  // Whether a column of `child` is a foreign key to the table of `parent`.
  function pointsAt(child: readonly ColumnRef[], parent: readonly ColumnRef[]) {
    return child.some((c) => references.has(`${c.table}.${c.column}->${parent[0].table}`));
  }
  function isKeyed(columns: readonly ColumnRef[]) {
    return (keys.get(columns[0].table) ?? []).some(
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
    return !isFkLikeName(from[0].column) && isFkLikeName(to[0].column);
  }
  function edge(parent: readonly ColumnRef[], child: readonly ColumnRef[], mustExist: boolean) {
    const [p] = parent;
    const [c] = child;
    return {
      fromModel: p.table,
      toModel: c.table,
      fromField: p.column,
      toField: c.column,
      isRequired: mustExist || (required.get(`${c.table}.${c.column}`) ?? true),
      enforced: false,
    };
  }

  return relationDefinitions(program, text).flatMap(({ relations }) =>
    relations.flatMap((relation) => {
      const { from, to } = relation;
      // The reverse side of a pair names no columns; the other table's side does.
      if (from === null || to === null) return [];
      // A many-to-many through a junction table is a key from each end into the junction.
      if (from.through.length > 0 && to.through.length > 0) {
        return [edge(from.columns, from.through, false), edge(to.columns, to.through, false)];
      }
      if (relation.kind === "many") return [edge(from.columns, to.columns, false)];
      return targetHoldsKey(from.columns, to.columns)
        ? [edge(from.columns, to.columns, false)]
        : [edge(to.columns, from.columns, relation.optional === false)];
    }),
  );
}

/**
 * Whether a callee builds a table: `pgTable`, `sqliteTable`, `mysqlTable`, ..., `pgTable.withRLS`,
 * and the `.table` of a casing or a schema (`snakeCase.table`, `camelCase.table`,
 * `pgSchema("auth").table`, `authSchema.table`); never `defineRelations`, whatever it is named.
 */
export function isTableBuilder(callee: string) {
  return /(?:Table|\.table)(?:\.withRLS)?$/u.test(callee.replace(/\s+/gu, ""));
}

/**
 * The top-level `xxxTable("name", { ...columns }, constraints)` calls, exported in place or in an
 * `export { ... }` list, with the variable they are bound to.
 */
export function tableCalls(program: Program, text: string) {
  return topLevelDeclarations(program).flatMap(({ declarator, start, end }) => {
    const varName = declaratorName(declarator);
    if (varName === null) return [];

    const init = declarator.init;
    if (!isCall(init)) return [];
    if (!isTableBuilder(textOf(text, init.callee))) return [];

    return [{ varName, args: init.arguments, start, end }];
  });
}

/** Each table of the schema with its columns: their types, keys and descriptions. */
export function parseTableInfo(code: readonly string[]) {
  const source = parseSource(code);
  const { program, text } = source;

  return tableCalls(program, text).flatMap(({ varName, args, start }) => {
    if (!isObject(args[1]) && !isArrow(args[1]) && args[1]?.type !== "Identifier") return [];

    const fields = columnProperties(args[1], program)
      .map((prop) => extractFieldInfo(prop, source))
      .filter((f): f is NonNullable<typeof f> => f !== null);

    return [{ name: varName, description: descriptionBefore(source, start), fields }];
  });
}

/**
 * Sources scanned: .references() calls, foreignKey() constraints, defineRelations() and
 * defineRelationsPart() exports. A pair found more than once keeps its first entry, so a foreign
 * key wins over a relation only `defineRelations` declares.
 */
export function extractRelationsFromSchema(code: readonly string[]) {
  const { program, text } = parseSource(code);

  const tableRelations = tableCalls(program, text).flatMap(({ varName, args }) => {
    const constraintArg = args[2];

    // Second argument: the columns, spreads of helper objects included
    const fieldRelations = columnProperties(args[1], program)
      .map((prop) => extractRelationFromField(prop, varName, text))
      .filter((r): r is NonNullable<typeof r> => r !== null);

    // Third argument: constraints (foreignKey, indexes, etc.)
    const fkRelations = constraintArg
      ? extractRelationsFromForeignKeyConstraints(varName, constraintArg, text)
      : [];

    return [...fieldRelations, ...fkRelations];
  });

  const allRelations = [
    ...tableRelations,
    ...extractRelationsFromDefinitions(program, text, tableRelations),
  ];

  // Deduplicate relations based on fromModel.fromField -> toModel.toField
  const seen = new Set<string>();
  const keys = keyedColumns(program, text);
  return allRelations
    .filter((r) => {
      const key = `${r.fromModel}.${r.fromField}->${r.toModel}.${r.toField}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((r) => ({
      ...r,
      // A child column that is a key of its own (`.primaryKey()`, `.unique()`, a one-column
      // `unique()` constraint) holds at most one row per parent: a one-to-one.
      isUnique: (keys.get(r.toModel) ?? []).some((k) => k.length === 1 && k[0] === r.toField),
    }));
}
