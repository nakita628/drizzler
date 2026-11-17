import type { TSEnumDeclaration } from "oxc-parser";
import { parseSync } from "oxc-parser";

// The words a member cannot be bound to as a local `const`, though it may be an enum member.
const RESERVED = new Set([
  "arguments",
  "await",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "eval",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "if",
  "implements",
  "import",
  "in",
  "instanceof",
  "interface",
  "let",
  "new",
  "null",
  "package",
  "private",
  "protected",
  "public",
  "return",
  "static",
  "super",
  "switch",
  "this",
  "throw",
  "true",
  "try",
  "typeof",
  "undefined",
  "var",
  "void",
  "while",
  "with",
  "yield",
]);

// The object the enum's body is built on inside the function, named so no member shadows it.
const SELF = "__drizzler_enum";

function isNode(value: unknown): value is { readonly type: string } {
  return typeof value === "object" && value !== null && "type" in value;
}

function isEnum(node: { readonly type: string }): node is TSEnumDeclaration {
  return node.type === "TSEnumDeclaration";
}

// Every enum declaration in a subtree, nested ones included (an enum may sit in a function).
function enumsIn(node: unknown): TSEnumDeclaration[] {
  if (Array.isArray(node)) return node.flatMap(enumsIn);
  if (!isNode(node)) return [];
  const own = isEnum(node) ? [node] : [];
  const children = Object.entries(node).flatMap(([key, value]) =>
    key === "parent" ? [] : enumsIn(value),
  );
  return [...own, ...children];
}

/**
 * The JavaScript an enum stands for, as TypeScript emits it: an object with each member, and a
 * reverse entry (`E[0] === "A"`) for each numeric one. A member with no initializer is the one
 * before it plus one (0 for the first). A member is a local `const` of the function too, so a
 * later initializer may name an earlier member bare (`B = A << 1`). Written on one line, with the
 * declaration's line breaks after it, so every line below stays where it was.
 */
function enumCode(declaration: TSEnumDeclaration, source: string) {
  const name = declaration.id.name;
  const { members } = declaration.body;
  // The member's key, and the local it is bound to: its own name when that can be one.
  const keys = members.map(({ id }) => {
    if (id.type === "Identifier") return id.name;
    return id.type === "Literal" ? id.value : id.quasis.map((q) => q.value.cooked ?? "").join("");
  });
  const locals = members.map(({ id }, index) =>
    id.type === "Identifier" && !RESERVED.has(id.name) && id.name !== SELF
      ? id.name
      : `${SELF}_${index}`,
  );
  const statements = members.map((member, index) => {
    const local = locals[index] ?? `${SELF}_${index}`;
    const previous = locals[index - 1];
    const next = previous === undefined ? "0" : `${previous} + 1`;
    const init = member.initializer
      ? source.slice(member.initializer.start, member.initializer.end)
      : next;
    const quoted = JSON.stringify(keys[index]);
    return `const ${local} = (${init}); ${SELF}[${quoted}] = ${local}; if (typeof ${local} === "number") ${SELF}[${local}] = ${quoted};`;
  });
  return `var ${name} = (function (${SELF}) { ${statements.join(" ")} return ${SELF}; })(${name} || {});`;
}

/**
 * The source with each `enum` (and `const enum`) written as the object it stands for: Node's type stripping rejects an enum (`TypeScript enum is not
 * supported in strip-only mode`) and no longer offers a mode that transforms one, while a
 * bundler (drizzle-kit's esbuild) builds it. `export enum E {}` becomes `export var E = ...`.
 * A source with no enum comes back as it is.
 */
export function lowerEnums(source: string, file = "schema.ts") {
  if (!/\benum\b/u.test(source)) return source;
  const lang = /\.(c|m)?tsx$/u.test(file) ? "tsx" : "ts";
  const { program, errors } = parseSync(file, source, { lang, sourceType: "module" });
  if (errors.length > 0) return source;
  // A `declare enum` is a type only, which strip mode erases on its own.
  const declarations = enumsIn(program.body)
    .filter((declaration) => !declaration.declare)
    .toSorted((a, b) => b.start - a.start);
  return declarations.reduce((text, declaration) => {
    const original = text.slice(declaration.start, declaration.end);
    const breaks = original.replaceAll(/[^\n]/gu, "");
    return (
      text.slice(0, declaration.start) +
      enumCode(declaration, source) +
      breaks +
      text.slice(declaration.end)
    );
  }, source);
}
