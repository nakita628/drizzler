// Helpers shared by the rules.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// The linted file's path, on the current and the older rule-context API alike.
export function getFilename(context) {
  return context.filename ?? context.getFilename?.() ?? "";
}

// A node's [start, end] in the source.
export function rangeOf(node) {
  return node.range ?? [node.start, node.end];
}

// Whether node `a` lies inside node `b`.
export function within(a, b) {
  const [aStart, aEnd] = rangeOf(a);
  const [bStart, bEnd] = rangeOf(b);
  return aStart >= bStart && aEnd <= bEnd;
}

// The `xxx` of `Effect.xxx`, or null for anything else.
export function effectMethod(callee) {
  if (
    callee?.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "Identifier" &&
    callee.object.name === "Effect" &&
    callee.property.type === "Identifier"
  ) {
    return callee.property.name;
  }
  return null;
}

/** Test files, which build fixtures freely and are exempt from most rules. */
export const TEST_FILE = /\.test\.tsx?$/;

/** A barrel module that only re-exports. */
export const INDEX_FILE = /(^|[\\/])index\.tsx?$/;

const SERVER_LAYER =
  /(^|[\\/])studio[\\/]server[\\/](handlers|usecases|services|domain|errors)[\\/]/;

/** The studio server layer a file belongs to, or null outside them. */
export function layerOf(filename) {
  return SERVER_LAYER.exec(filename)?.[2] ?? null;
}

/** The whole source text of the linted file. */
export function sourceText(context) {
  return context.sourceCode?.text ?? context.getSourceCode?.().text ?? "";
}

/** The TSDoc block (`/** … *\/`) written directly above a node, or null. */
export function leadingTsdoc(context, node) {
  const text = sourceText(context);
  const [start] = rangeOf(node);
  const before = text.slice(0, start).trimEnd();
  if (!before.endsWith("*/")) return null;
  const open = before.lastIndexOf("/**");
  if (open === -1) return null;
  // A block comment that opens with `/*` but not `/**` is not TSDoc.
  const close = before.indexOf("*/", open);
  return close === before.length - 2 ? before.slice(open) : null;
}

function isFunctionInit(declarator) {
  const init = declarator.init;
  return (
    init?.type === "ArrowFunctionExpression" ||
    init?.type === "FunctionExpression" ||
    // `export const handler: RouteHandler<typeof route> = (c) => …`
    (declarator.id.typeAnnotation !== undefined &&
      declarator.id.typeAnnotation !== null &&
      init != null)
  );
}

/**
 * The functions and classes an export statement declares: a function declaration, a class, or a
 * const holding a function. Each comes with the node its TSDoc sits above (the export).
 */
export function exportedDeclarations(node) {
  const declaration = node.declaration;
  if (declaration?.type === "FunctionDeclaration" && declaration.id) {
    return [{ name: declaration.id.name, kind: "function", fn: declaration, node }];
  }
  if (declaration?.type === "ClassDeclaration" && declaration.id) {
    return [{ name: declaration.id.name, kind: "class", fn: null, node }];
  }
  if (declaration?.type === "VariableDeclaration") {
    return declaration.declarations
      .filter((d) => d.id.type === "Identifier" && isFunctionInit(d))
      .map((d) => ({
        name: d.id.name,
        kind: "function",
        fn:
          d.init.type === "ArrowFunctionExpression" || d.init.type === "FunctionExpression"
            ? d.init
            : null,
        node,
      }));
  }
  return [];
}

/** Resolve a relative import specifier against the importing file. */
export function resolveRelative(filename, specifier) {
  if (!specifier.startsWith(".")) return null;
  const parts = filename.split(/[\\/]/u).slice(0, -1);
  for (const segment of specifier.split("/")) {
    if (segment === "..") parts.pop();
    else if (segment !== ".") parts.push(segment);
  }
  return parts.join("/");
}
