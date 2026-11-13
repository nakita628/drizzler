// drizzler's own lint rules (an oxlint JS plugin; rules are written as ESLint rules are).
// Ported from the `custom` plugin of hakadate-developer-conference, keeping only the rules that do
// not depend on that app's layout (handlers / usecases / services, Zod contracts). These look at
// what a config glob cannot: the code itself.
//
// 1. Name modules for what they do
//   no-utils-module         no module may be named `utils`
// 2. Do not modify values (build new ones instead)
//   no-let                  no `let`; compute a value once with `const`
//   no-array-mutation       no in-place array methods (push / sort / splice / ...)
//   no-property-assignment  no assigning to or deleting object properties (React refs excepted)
//   require-as-const        module-level object / array constants end with `as const`
//   no-type-assertion       no `x as T` / `<T>x` (`as const` is fine)
// 3. Do not hide failures
//   match-exhaustive        `Match.value(...).pipe(...)` ends with `Match.exhaustive`; no `Match.orElse`
//   catch-must-log          recovering from a failure logs it or turns it into another failure
//   promise-catch-must-log  a Promise `.catch` logs, rethrows or rejects (studio server)
//
// Test files (*.test.ts / *.test.tsx) are exempt from the rules that build fixtures by mutation.

const UTILS_DIRECTORY = /(^|[\\/])utils[\\/]/;
const UTILS_FILE = /(^|[\\/])utils\.tsx?$/;

import { docRules } from "./docs.js";
import { TEST_FILE, effectMethod, getFilename, rangeOf, sourceText, within } from "./helpers.js";
import { layerRules } from "./layers.js";
import { perfRules } from "./perf.js";

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

const plugin = {
  meta: { name: "custom" },
  rules: {
    ...docRules,
    ...layerRules,
    ...perfRules,
    // =========================================================================
    // 1. Name modules for what they do
    // =========================================================================

    // Why: a `utils` module becomes a drawer anything can be dropped into. Name a module for
    //      what it does, so its name says what is in it.
    //   NG: src/utils/index.ts
    //   OK: src/schema/strip-imports.ts
    "no-utils-module": {
      meta: { docs: { description: "no module may be named utils" } },
      create(context) {
        return {
          Program(node) {
            const filename = getFilename(context);
            if (!UTILS_DIRECTORY.test(filename) && !UTILS_FILE.test(filename)) return;
            context.report({
              node,
              message:
                "Do not put code in a `utils` module. Put it in a module named for what it does (`strip-imports.ts`, `layout.ts`), so its name says what is inside.",
            });
          },
        };
      },
    },

    // =========================================================================
    // 2. Do not modify values (build new ones instead)
    // =========================================================================

    // Why: a reassigned variable makes the reader track what it holds at each line.
    //   NG: let total = 0; for (const table of tables) total += table.fields.length
    //   OK: const total = tables.reduce((sum, table) => sum + table.fields.length, 0)
    "no-let": {
      meta: { docs: { description: "disallow let; build values with const and new values" } },
      create(context) {
        if (TEST_FILE.test(getFilename(context))) return {};
        return {
          VariableDeclaration(node) {
            if (node.kind !== "let") return;
            context.report({
              node,
              message:
                "Do not use `let`. A reassigned variable makes the reader track what it holds at each line. Compute the value once with `const` (map / filter / reduce / a ternary), or return a new value instead of updating the old one.",
            });
          },
        };
      },
    },

    // Why: anyone holding the same array sees an in-place change.
    //   NG: files.push(file) / files.sort(byName) / files.splice(0, 1) / files.reverse()
    //   OK: [...files, file] / files.toSorted(byName) / files.toSpliced(0, 1) / files.toReversed()
    "no-array-mutation": {
      meta: { docs: { description: "disallow in-place array mutation methods" } },
      create(context) {
        if (TEST_FILE.test(getFilename(context))) return {};
        const instead = {
          push: "[...items, item]",
          pop: "items.slice(0, -1) / items.at(-1)",
          shift: "items.slice(1) / items[0]",
          unshift: "[item, ...items]",
          splice: "items.toSpliced(...)",
          sort: "items.toSorted(...)",
          reverse: "items.toReversed()",
          fill: "Array.from({ length }, () => value)",
          copyWithin: "a new array built with slice / spread",
        };
        return {
          CallExpression(node) {
            const callee = node.callee;
            if (
              callee.type !== "MemberExpression" ||
              callee.computed ||
              callee.property.type !== "Identifier"
            ) {
              return;
            }
            const name = callee.property.name;
            if (!Object.hasOwn(instead, name)) return;
            context.report({
              node,
              message: `Do not mutate an array in place with \`.${name}()\`. Anyone holding the same array sees the change. Build a new array instead: ${instead[name]}.`,
            });
          },
        };
      },
    },

    // Why: `const` does not stop an object's contents from changing under whoever holds it.
    //   NG: const row = { id }; row.id = next
    //   NG: delete row.password
    //   OK: const row = { ...previous, id: next }
    //   OK: const { password, ...rest } = row
    // React refs (`ref.current = …`) and the DOM behind them (`inputRef.current.value = ''`) are
    // exempt: a ref is a box meant to be written, and the DOM is driven imperatively.
    "no-property-assignment": {
      meta: { docs: { description: "disallow assigning to or deleting object properties" } },
      create(context) {
        if (TEST_FILE.test(getFilename(context))) return {};
        const message =
          "Do not modify an object property. Build a new object instead (`{ ...value, field }`, or destructure with `const { field, ...rest } = value` to drop one). Only React refs (`ref.current = …`, `inputRef.current.value = …`) are exempt.";
        function isCurrent(node) {
          return (
            node.type === "MemberExpression" &&
            !node.computed &&
            node.property.type === "Identifier" &&
            node.property.name === "current"
          );
        }
        function isRefCurrent(node) {
          return isCurrent(node) || (node.type === "MemberExpression" && isCurrent(node.object));
        }
        return {
          AssignmentExpression(node) {
            if (node.left.type === "MemberExpression" && !isRefCurrent(node.left)) {
              context.report({ node, message });
            }
          },
          UpdateExpression(node) {
            if (node.argument.type === "MemberExpression" && !isRefCurrent(node.argument)) {
              context.report({ node, message });
            }
          },
          UnaryExpression(node) {
            if (node.operator === "delete") context.report({ node, message });
          },
        };
      },
    },

    // Why: a table of constants is not meant to change, so the type should say so too.
    //      `as const` makes it readonly and keeps its literal types.
    //   NG: const MODULE_EXTENSIONS = ['.ts', '.mts']
    //   OK: const MODULE_EXTENSIONS = ['.ts', '.mts'] as const
    //   OK: const LABELS = { one: '1' } as const satisfies Record<string, string>
    // Strings and numbers need nothing: a `const` primitive is already its literal type.
    "require-as-const": {
      meta: {
        docs: { description: "module-level object / array constants must end with as const" },
      },
      create(context) {
        if (TEST_FILE.test(getFilename(context))) return {};
        function isAsConst(node) {
          return (
            node.type === "TSAsExpression" &&
            node.typeAnnotation.type === "TSTypeReference" &&
            node.typeAnnotation.typeName.type === "Identifier" &&
            node.typeAnnotation.typeName.name === "const"
          );
        }
        // `( … )` and `satisfies T` are looked through: `{ … } as const satisfies T` passes,
        // `{ … } satisfies T` does not.
        function unwrap(node) {
          if (node.type === "ParenthesizedExpression") return unwrap(node.expression);
          if (node.type === "TSSatisfiesExpression") return unwrap(node.expression);
          return node;
        }
        return {
          VariableDeclarator(node) {
            const declaration = node.parent;
            const scope = declaration.parent;
            if (declaration.kind !== "const" || !node.init) return;
            const atTop =
              scope.type === "Program" ||
              (scope.type === "ExportNamedDeclaration" && scope.parent.type === "Program");
            if (!atTop) return;
            const inner = unwrap(node.init);
            if (isAsConst(inner)) return;
            if (inner.type !== "ObjectExpression" && inner.type !== "ArrayExpression") return;
            context.report({
              node: node.init,
              message: `Add \`as const\` to this ${inner.type === "ObjectExpression" ? "object" : "array"} literal (a module-level constant), so it is typed readonly and cannot be modified later. With \`satisfies\`, write \`{ … } as const satisfies T\`.`,
            });
          },
        };
      },
    },

    // Why: an assertion only tells the compiler to trust you; nothing is checked at runtime.
    //   NG: const config = value as Config
    //   NG: const config = <Config>value
    //   OK: if (isConfig(value)) { … }        // narrow with a type guard
    //   OK: const KINDS = ['dbml', 'md'] as const
    "no-type-assertion": {
      meta: { docs: { description: "disallow type assertions except `as const`" } },
      create(context) {
        function isConst(node) {
          const t = node.typeAnnotation;
          return (
            t?.type === "TSTypeReference" &&
            t.typeName?.type === "Identifier" &&
            t.typeName.name === "const"
          );
        }
        const message =
          "Do not use a type assertion. It only tells the compiler to trust you and checks nothing at runtime. Narrow the value with a type guard (or parse it with its schema) so the type is earned, not asserted. `as const` is fine.";
        return {
          TSAsExpression(node) {
            if (!isConst(node)) context.report({ node, message });
          },
          TSTypeAssertion(node) {
            if (!isConst(node)) context.report({ node, message });
          },
        };
      },
    },

    // =========================================================================
    // 3. Do not hide failures
    // =========================================================================

    // Why: a catch-all branch swallows every failure added later. Ending with Match.exhaustive
    //      turns a new failure into a type error instead.
    //   NG: Match.value(error).pipe(Match.tag('FileReadError', ...), Match.orElse(() => ...))
    //   NG: Match.value(error).pipe(Match.tag('FileReadError', ...))   // no end
    //   OK: Match.value(error).pipe(Match.tag('A', ...), Match.tag('B', ...), Match.exhaustive)
    "match-exhaustive": {
      meta: {
        docs: {
          description:
            "Match pipelines must end with Match.exhaustive; Match.orElse is not allowed",
        },
      },
      create(context) {
        function isMatchMember(node, name) {
          return (
            node?.type === "MemberExpression" &&
            !node.computed &&
            node.object.type === "Identifier" &&
            node.object.name === "Match" &&
            node.property.type === "Identifier" &&
            node.property.name === name
          );
        }
        return {
          MemberExpression(node) {
            if (isMatchMember(node, "orElse")) {
              context.report({
                node,
                message:
                  "Do not use `Match.orElse`. A catch-all branch swallows every failure added later without a type error. List each `_tag` with `Match.tag` and end with `Match.exhaustive`.",
              });
            }
          },
          CallExpression(node) {
            // Only the `Match.value(x).pipe(...)` shape.
            const callee = node.callee;
            if (
              callee.type !== "MemberExpression" ||
              callee.computed ||
              callee.property.type !== "Identifier" ||
              callee.property.name !== "pipe"
            ) {
              return;
            }
            const target = callee.object;
            if (target.type !== "CallExpression" || !isMatchMember(target.callee, "value")) return;
            const last = node.arguments.at(-1);
            if (isMatchMember(last, "exhaustive")) return;
            context.report({
              node,
              message:
                "End this `Match.value(...).pipe(...)` with `Match.exhaustive`, so that adding a new failure to the Effect makes this a type error instead of an unhandled case.",
            });
          },
        };
      },
    },

    // Why: a Promise's `.catch` that returns a value drops the failure as surely as an
    //      Effect.catch that does: the reason never reaches a log.
    //   NG: client.end().catch(() => undefined)
    //   OK: Effect.tryPromise(() => client.end()).pipe(Effect.catch((e) => Effect.logWarning("...", e)))
    "promise-catch-must-log": {
      meta: { docs: { description: "a Promise .catch must log, rethrow or reject" } },
      create(context) {
        if (TEST_FILE.test(getFilename(context))) return {};
        const HANDLES = /\blog\w*\(|\bthrow\b|\breject\(|\.fail\(/u;
        return {
          CallExpression(node) {
            const callee = node.callee;
            if (callee.type !== "MemberExpression" || callee.computed) return;
            if (callee.property.type !== "Identifier" || callee.property.name !== "catch") return;
            if (callee.object.type === "Identifier" && callee.object.name === "Effect") return;
            const [handler] = node.arguments;
            if (
              handler?.type !== "ArrowFunctionExpression" &&
              handler?.type !== "FunctionExpression"
            ) {
              return;
            }
            const [start, end] = rangeOf(handler);
            if (HANDLES.test(sourceText(context).slice(start, end))) return;
            context.report({
              node,
              message:
                "This `.catch` drops the failure without a trace. Log it, rethrow it, or wrap the Promise in `Effect.tryPromise` and recover with `Effect.catch((error) => Effect.logWarning('...', error))`.",
            });
          },
        };
      },
    },

    // Why: a failure recovered from without a trace is gone for good. A recovery must log the
    //      failure or turn it into another named failure; `Effect.ignore` leaves nothing.
    //   NG: removeFile(path).pipe(Effect.catch(() => Effect.void))
    //   NG: removeFile(path).pipe(Effect.ignore)
    //   OK: removeFile(path).pipe(Effect.catch((error) => Effect.logWarning('cannot remove', error)))
    //   OK: readRow().pipe(Effect.catch(() => Effect.fail(new NotFoundError({ table }))))
    "catch-must-log": {
      meta: {
        docs: {
          description: "recovering from a failure must log it or turn it into another failure",
        },
      },
      create(context) {
        if (TEST_FILE.test(getFilename(context))) return {};
        const RECOVER =
          /^(catch|catchAll|catchCause|catchAllCause|catchTag|catchTags|catchIf|catchSome|catchSomeCause|orElse|orElseSucceed|orElseFail)$/;
        const open = [];
        return {
          // `Effect.ignore` is passed as a value (`pipe(Effect.ignore)`), so it is found by reference.
          MemberExpression(node) {
            const method = effectMethod(node);
            if (method === null || !/^ignore/.test(method)) return;
            context.report({
              node,
              message: `Do not use \`Effect.${method}\`: it drops the failure without a trace. Use \`Effect.catch((error) => Effect.logError('...', error))\` so the failure is at least logged.`,
            });
          },
          CallExpression(node) {
            const method = effectMethod(node.callee);
            if (method === null) return;
            if (RECOVER.test(method)) {
              open.push({ node, method, handled: false });
              return;
            }
            if (/^log/.test(method) || method === "fail" || method === "failSync") {
              for (const frame of open) if (within(node, frame.node)) frame.handled = true;
            }
          },
          "CallExpression:exit"(node) {
            const index = open.findIndex((frame) => frame.node === node);
            if (index === -1) return;
            const [frame] = open.splice(index, 1);
            if (frame.handled) return;
            context.report({
              node,
              message: `\`Effect.${frame.method}\` swallows the failure. Log it (\`Effect.logError('...', error)\`) or turn it into another named failure (\`Effect.fail(new XxxError(...))\`) so it never disappears silently.`,
            });
          },
        };
      },
    },
  },
};

export default plugin;
