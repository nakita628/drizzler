// Layering rules for the studio's API (packages/drizzler/src/studio/server):
//
//   handlers → usecases → services        (and usecases → domain)
//
// A handler maps HTTP to one usecase; a usecase composes services (I/O) and domain (pure
// decisions); a service touches one piece of I/O; domain takes values and returns values.
//
//   no-usecase-to-usecase      a usecase does not import another usecase
//   no-service-to-service      a service does not import another service's values
//   domain-only-from-usecases  only usecases (and domain) import domain's values
//   domain-import-allowlist    domain imports only zod, other domain modules and the library's types
//   domain-no-nondeterminism   domain does not read the clock or make random values
//   domain-no-side-effects     domain does no I/O, is not async and keeps no module state
//   pure-no-throw              pure code returns its failures; it does not throw, catch or JSON.parse
//   effect-compute-only        a module that uses Effect only as an error channel uses no Effect I/O
//   handler-one-usecase        a handler calls at most one usecase
//   handler-request-valid      a handler reads its input only as `const data = c.req.valid(...)`
//   handler-response-shape     a 2xx body is parsed with its generated schema; a problem body is not
//   effect-run-at-edge         Effects are run only in handlers and the app's error handler (index.ts)
//   no-throw / no-try-catch    failures are Effect failures, not exceptions
//   no-class                   the only classes are the Data.TaggedError failures in errors/
//   layer-function-shape       usecase / service / domain functions take at most one argument, `input`
//   layer-suffix-pascal-case   `*UseCase` / `*Service` / `*Domain` names start uppercase
//   logic-camel-case           functions and variables are camelCase (constants UPPER_SNAKE)

import {
  INDEX_FILE,
  TEST_FILE,
  effectMethod,
  getFilename,
  layerOf,
  resolveRelative,
  within,
} from "./helpers.js";

const CAMEL_CASE = /^[a-z][A-Za-z0-9]*$/;
const UPPER_SNAKE = /^[A-Z][A-Z0-9_]*$/;
const PASCAL_CASE = /^[A-Z][A-Za-z0-9]*$/;
const LAYER_SUFFIX = /(UseCase|Service|Domain)$/;
const DOMAIN_PATH = /(^|[\\/])studio[\\/]server[\\/]domain([\\/]|$)/;
// Effects may be run here: the handlers (the HTTP edge) and index.ts (the app's error handler).
const EFFECT_EDGE = /(^|[\\/])studio[\\/]server[\\/](handlers[\\/]|index\.ts$)/;

// The specifier of an import / re-export statement, when it has one.
function sourceOf(node) {
  const value = node.source?.value;
  return typeof value === "string" ? value : null;
}

// Whether a statement imports only types (`import type`, `export type`), which carry no behaviour.
function isTypeOnly(node) {
  if (node.importKind === "type" || node.exportKind === "type") return true;
  return (
    node.specifiers?.length > 0 &&
    node.specifiers.every((s) => s.importKind === "type" || s.exportKind === "type")
  );
}

// Visit every import / re-export of a module.
function onImports(check) {
  return {
    ImportDeclaration: check,
    ExportNamedDeclaration(node) {
      if (node.source) check(node);
    },
    ExportAllDeclaration: check,
  };
}

function isCallOn(node, objectName, propertyName) {
  const callee = node.callee;
  return (
    callee?.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "Identifier" &&
    callee.object.name === objectName &&
    callee.property.type === "Identifier" &&
    (propertyName === undefined || callee.property.name === propertyName)
  );
}

// `c.req.<method>(...)`.
function requestMethod(node) {
  const callee = node.callee;
  if (
    callee.type !== "MemberExpression" ||
    callee.computed ||
    callee.property.type !== "Identifier" ||
    callee.object.type !== "MemberExpression" ||
    callee.object.computed ||
    callee.object.object.type !== "Identifier" ||
    callee.object.object.name !== "c" ||
    callee.object.property.type !== "Identifier" ||
    callee.object.property.name !== "req"
  ) {
    return null;
  }
  return callee.property.name;
}

export const layerRules = {
  // Why: usecases sit side by side, each owning a request end to end. Let two call each other and
  //      the layer stops being one: a cycle waits, and neither reads without the other.
  //   NG: usecases/db.ts:   import { readDocs } from "./docs.js"
  //   OK: move the shared part into a service (I/O) or domain (a pure decision)
  "no-usecase-to-usecase": {
    meta: { docs: { description: "a usecase may not import another usecase" } },
    create(context) {
      const filename = getFilename(context);
      if (layerOf(filename) !== "usecases" || INDEX_FILE.test(filename) || TEST_FILE.test(filename))
        return {};
      return onImports((node) => {
        const source = sourceOf(node);
        if (source === null) return;
        if (!source.startsWith("./") && !/(^|\/)usecases(\/|$)/u.test(source)) return;
        context.report({
          node: node.source,
          message: `A usecase may not import another usecase (\`${source}\`). Each usecase owns one request end to end; move what they share into a service (I/O) or domain (a pure decision).`,
        });
      });
    },
  },

  // Why: a service touches one piece of I/O; combining them is the usecase's job, so reading the
  //      usecase shows everything that happens. Types may be shared.
  //   NG: services/query.ts: import * as ParseService from "./parse.js"
  //   OK: usecases/query.ts calls ParseService, then QueryService
  //   OK: import type { Driver } from "./database.js"
  "no-service-to-service": {
    meta: { docs: { description: "a service may not import another service's values" } },
    create(context) {
      const filename = getFilename(context);
      if (layerOf(filename) !== "services" || INDEX_FILE.test(filename) || TEST_FILE.test(filename))
        return {};
      return onImports((node) => {
        const source = sourceOf(node);
        if (source === null || isTypeOnly(node)) return;
        if (!source.startsWith("./") && !/(^|\/)services(\/|$)/u.test(source)) return;
        context.report({
          node: node.source,
          message: `A service may not import another service (\`${source}\`). Each service touches one piece of I/O; call both from the usecase instead, so reading it shows everything that happens. \`import type\` is fine.`,
        });
      });
    },
  },

  // Why: domain holds the pure decisions and the usecase is the one place that applies them.
  //      A handler maps HTTP, a service does I/O; neither decides. Types may be shared.
  //   NG: services/database.ts: import { dialectOf } from "../domain/sql.js"
  //   OK: usecases/db.ts:       import * as SqlDomain from "../domain/sql.js"
  //   OK: import type { Dialect } from "../domain/sql.js"
  "domain-only-from-usecases": {
    meta: { docs: { description: "only usecases (and domain itself) may import domain's values" } },
    create(context) {
      const filename = getFilename(context);
      const layer = layerOf(filename);
      if (layer === "usecases" || layer === "domain" || TEST_FILE.test(filename)) return {};
      return onImports((node) => {
        const source = sourceOf(node);
        if (source === null || isTypeOnly(node)) return;
        const resolved = resolveRelative(filename, source);
        if (resolved === null || !DOMAIN_PATH.test(resolved)) return;
        context.report({
          node: node.source,
          message: `Only usecases may import domain (\`${source}\`). Domain holds the pure decisions and the usecase is the one place that applies them; pass the decided value to the service instead. \`import type\` is fine.`,
        });
      });
    },
  },

  // Why: domain is pure functions over plain values. An allowlist, not a denylist, so a new
  //      library (ids, dates, http, effect) cannot slip in.
  //   NG: import { Effect } from "effect" / import fs from "node:fs" / import "../services/file.js"
  //   OK: import { z } from "zod" / import * as ParseDomain from "./parse.js"
  //   OK: import type { SchemaModel } from "../../../types/index.js"
  "domain-import-allowlist": {
    meta: {
      docs: {
        description: "domain may import only zod, other domain modules and the library's types",
      },
    },
    create(context) {
      if (TEST_FILE.test(getFilename(context))) return {};
      const allowed = [/^zod(\/.*)?$/u, /^\.\/[^/]+$/u, /^(\.\.\/)+types(\/index\.js)?$/u];
      return {
        ...onImports((node) => {
          const source = sourceOf(node);
          if (source === null || allowed.some((pattern) => pattern.test(source))) return;
          context.report({
            node: node.source,
            message: `Domain may import only zod, other domain modules and the library's types, not \`${source}\`. Anything that talks to the outside world belongs in a service; the usecase passes the result in as a value.`,
          });
        }),
        ImportExpression(node) {
          context.report({
            node,
            message: "Domain may not import modules at runtime (`import()`).",
          });
        },
      };
    },
  },

  // Why: a domain function returns the same answer for the same arguments. The clock and random
  //      values change on every call; read them in the usecase and pass them in.
  //   NG: Date.now() / new Date() / Math.random() / crypto.randomUUID()
  //   OK: new Date(input.at)      // a Date with an argument is a fixed value
  "domain-no-nondeterminism": {
    meta: { docs: { description: "domain must not read the clock or generate random values" } },
    create(context) {
      if (TEST_FILE.test(getFilename(context))) return {};
      const fix =
        "Pure functions (the studio's domain, sql, generator, diagram, helper) must return the same answer for the same arguments. Read the clock / make the value in the caller (a usecase, core/, the CLI) and pass it in.";
      const banned = {
        Date: ["now"],
        Math: ["random"],
        crypto: ["randomUUID", "getRandomValues"],
        performance: ["now"],
      };
      return {
        CallExpression(node) {
          const callee = node.callee;
          if (
            callee.type === "MemberExpression" &&
            !callee.computed &&
            callee.object.type === "Identifier" &&
            callee.property.type === "Identifier" &&
            banned[callee.object.name]?.includes(callee.property.name)
          ) {
            context.report({
              node,
              message: `\`${callee.object.name}.${callee.property.name}()\` in pure code. ${fix}`,
            });
          }
          if (callee.type === "Identifier" && callee.name === "Date") {
            context.report({ node, message: `\`Date()\` in pure code. ${fix}` });
          }
        },
        NewExpression(node) {
          if (
            node.callee.type === "Identifier" &&
            node.callee.name === "Date" &&
            node.arguments.length === 0
          ) {
            context.report({ node, message: `\`new Date()\` in pure code. ${fix}` });
          }
        },
      };
    },
  },

  // Why: domain takes values and returns values. I/O, timers, async and module state make the
  //      answer depend on the world or on call order.
  //   NG: console.log(x) / process.cwd() / setTimeout(...) / async function f() {} / let cache
  //   OK: export function isKeyed(input: { … }) { return … }
  "domain-no-side-effects": {
    meta: {
      docs: { description: "domain must not perform I/O, be async, or keep module state" },
    },
    create(context) {
      if (TEST_FILE.test(getFilename(context))) return {};
      const IO_CALLS = new Set([
        "fetch",
        "setTimeout",
        "setInterval",
        "setImmediate",
        "queueMicrotask",
        "require",
      ]);
      const IO_OBJECTS = new Set(["console", "process", "window", "document", "globalThis"]);
      const tail =
        "Pure functions take values and return values; do this in a service (or core/, schema/sources.ts) and pass the result in.";
      function reportAsync(node) {
        if (node.async) {
          context.report({
            node,
            message:
              "Async function in pure code. Pure code is synchronous: await in the caller and pass the value in.",
          });
        }
      }
      return {
        CallExpression(node) {
          if (node.callee.type === "Identifier" && IO_CALLS.has(node.callee.name)) {
            context.report({ node, message: `\`${node.callee.name}()\` in pure code. ${tail}` });
          }
        },
        MemberExpression(node) {
          if (node.object.type === "Identifier" && IO_OBJECTS.has(node.object.name)) {
            context.report({ node, message: `\`${node.object.name}\` in pure code. ${tail}` });
          }
        },
        FunctionDeclaration: reportAsync,
        FunctionExpression: reportAsync,
        ArrowFunctionExpression: reportAsync,
        Program(node) {
          for (const statement of node.body) {
            const declaration =
              statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
            if (declaration?.type === "VariableDeclaration" && declaration.kind !== "const") {
              context.report({
                node: declaration,
                message: `Module-level \`${declaration.kind}\` in pure code: shared mutable state makes the answer depend on call order.`,
              });
            }
          }
        },
      };
    },
  },

  // Why: a pure function's failure is part of its answer. A throw leaves the type, and a caller
  //      that forgets a try / catch crashes; JSON.parse throws on text that is not JSON.
  //   NG: throw new Error("bad") / try { … } catch { … } / JSON.parse(text)
  //   OK: return { error: "bad" } / return null, and parse JSON in the I/O layer (Effect.try)
  "pure-no-throw": {
    meta: {
      docs: { description: "pure code returns failures; it does not throw, catch or JSON.parse" },
    },
    create(context) {
      if (TEST_FILE.test(getFilename(context))) return {};
      const tail =
        "Pure code returns its failure as a value (`{ error }`, null) so it shows in the type. Parse JSON, and run code that throws, in the I/O layer (Effect.try) and pass the value in.";
      return {
        ThrowStatement(node) {
          context.report({ node, message: `\`throw\` in pure code. ${tail}` });
        },
        TryStatement(node) {
          context.report({ node, message: `\`try\` in pure code. ${tail}` });
        },
        CallExpression(node) {
          if (isCallOn(node, "JSON", "parse")) {
            context.report({
              node,
              message: `\`JSON.parse\` throws on text that is not JSON. ${tail}`,
            });
          }
        },
      };
    },
  },

  // Why: some pure modules use Effect only as a typed error channel (\`yield* new XxxError()\`) over
  //      values they are handed. Effect can also do I/O; this keeps them to the combinators that
  //      compute, so one cannot start reading the clock, the environment or a file unnoticed.
  //   NG: Effect.sync(() => Date.now()) / Effect.promise(...) / Effect.log(...) / import { Clock } from "effect"
  //   OK: Effect.gen(function* () { … yield* new SeedConfigError({ … }) }) / Effect.forEach(xs, f)
  "effect-compute-only": {
    meta: { docs: { description: "a computing module uses only Effect's pure combinators" } },
    create(context) {
      if (TEST_FILE.test(getFilename(context))) return {};
      const COMBINATORS = new Set([
        "gen",
        "succeed",
        "fail",
        "map",
        "flatMap",
        "andThen",
        "forEach",
        "all",
        "as",
        "asVoid",
        "void",
        "mapError",
        "filterOrFail",
        "zip",
        "tap",
      ]);
      const tail =
        "This module computes: Effect is only its error channel. Do the I/O in the caller (seed/run.ts, a service) and pass the value in.";
      return {
        ImportDeclaration(node) {
          if (sourceOf(node) !== "effect" || node.importKind === "type") return;
          for (const specifier of node.specifiers) {
            if (specifier.type !== "ImportSpecifier" || specifier.importKind === "type") continue;
            const name = specifier.imported.name ?? specifier.imported.value;
            if (name === "Effect") continue;
            context.report({
              node: specifier,
              message: `\`${name}\` from effect in a computing module. ${tail}`,
            });
          }
        },
        MemberExpression(node) {
          const method = effectMethod(node);
          if (method === null || COMBINATORS.has(method)) return;
          context.report({ node, message: `\`Effect.${method}\` in a computing module. ${tail}` });
        },
      };
    },
  },

  // Why: one request is one usecase. Once a handler combines usecases, decisions leak into it.
  //   NG: DbUseCase.readStatus(); DocsUseCase.readDocs()     // in one handler
  //   OK: one usecase that does both, and the handler maps its result to HTTP
  "handler-one-usecase": {
    meta: { docs: { description: "a handler may call at most one usecase" } },
    create(context) {
      if (TEST_FILE.test(getFilename(context))) return {};
      const handlers = [];
      return {
        ExportNamedDeclaration(node) {
          if (node.declaration?.type !== "VariableDeclaration") return;
          for (const declarator of node.declaration.declarations) {
            if (declarator.init) handlers.push({ declarator, calls: new Set() });
          }
        },
        CallExpression(node) {
          const callee = node.callee;
          if (
            callee.type !== "MemberExpression" ||
            callee.computed ||
            callee.object.type !== "Identifier" ||
            !callee.object.name.endsWith("UseCase") ||
            callee.property.type !== "Identifier"
          ) {
            return;
          }
          const name = `${callee.object.name}.${callee.property.name}`;
          for (const handler of handlers) {
            if (within(node, handler.declarator)) handler.calls.add(name);
          }
        },
        "Program:exit"() {
          for (const { declarator, calls } of handlers) {
            if (calls.size <= 1) continue;
            context.report({
              node: declarator.id,
              message: `This handler calls ${calls.size} usecases (${[...calls].join(", ")}). One request is one usecase: combine them in a single usecase, and let the handler map its result to HTTP.`,
            });
          }
        },
      };
    },
  },

  // Why: a handler reads its input in exactly one shape, and only after the contract (main.tsp)
  //      validated it; `c.req.json()` and friends hand unvalidated values to the usecase.
  //   NG: const body = await c.req.json()
  //   NG: const { table } = c.req.valid("param")
  //   OK: const data = c.req.valid("json")
  //   OK: const data = { ...c.req.valid("param"), ...c.req.valid("json") }
  "handler-request-valid": {
    meta: {
      docs: { description: "handlers read input only as `const data = c.req.valid('...')`" },
    },
    create(context) {
      if (TEST_FILE.test(getFilename(context))) return {};
      const RAW_READERS = new Set([
        "json",
        "param",
        "query",
        "queries",
        "parseBody",
        "formData",
        "text",
        "arrayBuffer",
        "blob",
      ]);
      function isConstData(node) {
        const parent = node.parent;
        if (
          parent?.type === "SpreadElement" &&
          parent.parent?.type === "ObjectExpression" &&
          parent.parent.properties.every((p) => p.type === "SpreadElement")
        ) {
          return isConstData(parent.parent);
        }
        return (
          parent?.type === "VariableDeclarator" &&
          parent.init === node &&
          parent.id.type === "Identifier" &&
          parent.id.name === "data" &&
          parent.parent?.kind === "const"
        );
      }
      return {
        CallExpression(node) {
          const method = requestMethod(node);
          if (method === null) return;
          if (method === "valid") {
            if (isConstData(node)) return;
            context.report({
              node,
              message:
                "Read the validated input in one shape: `const data = c.req.valid('json' | 'query' | 'param')`, or `const data = { ...c.req.valid('param'), ...c.req.valid('json') }`. Don't destructure, rename or inline it.",
            });
            return;
          }
          if (!RAW_READERS.has(method)) return;
          context.report({
            node,
            message: `\`c.req.${method}()\` reads the request before validation. Declare the input in main.tsp and read it as \`const data = c.req.valid('...')\`.`,
          });
        },
      };
    },
  },

  // Why: a 2xx body is checked against the contract (main.tsp) before it leaves, so a body that
  //      drifted is caught. A problem body (4xx / 5xx) is a literal the handler writes itself:
  //      `as const` lets the route's types check it at compile time, and it is not parsed.
  //   NG: c.json(docs, 200)
  //   NG: c.json(InternalServerProblemSchema.parse({ … }), 500)
  //   OK: c.json(DocsSchema.parse(docs), 200)
  //   OK: c.json({ type: "/problems/not-found", … } as const, 404, { … })
  "handler-response-shape": {
    meta: {
      docs: {
        description:
          "2xx bodies are parsed with their schema; problem bodies are `as const` literals",
      },
    },
    create(context) {
      if (TEST_FILE.test(getFilename(context))) return {};
      function isSchemaParse(node) {
        return (
          node?.type === "CallExpression" &&
          node.callee.type === "MemberExpression" &&
          !node.callee.computed &&
          node.callee.property.type === "Identifier" &&
          node.callee.property.name === "parse"
        );
      }
      function isAsConstLiteral(node) {
        return (
          node?.type === "TSAsExpression" &&
          node.expression.type === "ObjectExpression" &&
          node.typeAnnotation.type === "TSTypeReference" &&
          node.typeAnnotation.typeName.type === "Identifier" &&
          node.typeAnnotation.typeName.name === "const"
        );
      }
      return {
        CallExpression(node) {
          if (!isCallOn(node, "c", "json")) return;
          const [body, status] = node.arguments;
          if (status?.type !== "Literal" || typeof status.value !== "number") return;
          if (status.value >= 200 && status.value < 300) {
            if (isSchemaParse(body)) return;
            context.report({
              node,
              message:
                "Check a 2xx body against its generated schema before it leaves: `c.json(XxxSchema.parse(value), 200)`, so a body that drifted from main.tsp is caught.",
            });
            return;
          }
          if (isAsConstLiteral(body)) return;
          context.report({
            node,
            message: isSchemaParse(body)
              ? "Do not parse a problem body. Write it as an object literal with `as const`: the route's types check it at compile time, and an error path never fails on its own validation."
              : "Write a problem body as an object literal with `as const`, so the route's types check every field at compile time.",
          });
        },
      };
    },
  },

  // Why: running an Effect inside a usecase or service lets its failure leave the type midway.
  //      Compose with `yield*`; only the HTTP edge runs Effects and maps failures to statuses.
  //   NG: usecases/db.ts: await Effect.runPromise(ParseService.readSchema(...))
  //   OK: usecases/db.ts: yield* ParseService.readSchema(...)
  //   OK: handlers/db.ts: return Effect.runPromise(Effect.matchEffect(...))
  "effect-run-at-edge": {
    meta: { docs: { description: "run Effects only at the HTTP edge (handlers, index.ts)" } },
    create(context) {
      const filename = getFilename(context);
      if (TEST_FILE.test(filename) || EFFECT_EDGE.test(filename)) return {};
      return {
        CallExpression(node) {
          const method = effectMethod(node.callee);
          if (method === null || !method.startsWith("run")) return;
          context.report({
            node,
            message: `\`Effect.${method}\` outside the HTTP edge. Return the Effect and compose it with \`yield*\`; only handlers (and index.ts's error handler) run Effects, so every failure stays in the type until a handler maps it to a status.`,
          });
        },
      };
    },
  },

  // Why: a thrown error is invisible in the type, so callers cannot know what to handle. Fail
  //      with a Data.TaggedError instead; the handler's Match.exhaustive then maps every one.
  //   NG: throw new Error("not configured")
  //   OK: return yield* new UnknownTableError({ table })
  "no-throw": {
    meta: { docs: { description: "fail with Effect failures, not throw" } },
    create(context) {
      if (TEST_FILE.test(getFilename(context))) return {};
      return {
        ThrowStatement(node) {
          context.report({
            node,
            message:
              "Do not throw. A thrown error is invisible in the type. Fail with a Data.TaggedError (`return yield* new XxxError({ … })`) so it shows in Effect<A, E> and the handler's Match.exhaustive maps it to a status.",
          });
        },
      };
    },
  },

  // Why: a caught error is `unknown`, so what failed disappears from the type.
  //   NG: try { await driver.query(sql) } catch (error) { … }
  //   OK: Effect.tryPromise({ try: () => driver.query(sql), catch: (cause) => new DatabaseError({ cause: String(cause) }) })
  "no-try-catch": {
    meta: { docs: { description: "use Effect.try / Effect.tryPromise, not try / catch" } },
    create(context) {
      if (TEST_FILE.test(getFilename(context))) return {};
      return {
        TryStatement(node) {
          context.report({
            node,
            message:
              "Do not use try / catch. The caught error is `unknown`, so the failure leaves the type. Wrap the call in `Effect.try` / `Effect.tryPromise({ try, catch: (cause) => new XxxError({ … }) })` so it has a name.",
          });
        },
      };
    },
  },

  // Why: data is plain objects and behaviour is functions. The only classes are the failures in
  //      errors/, as Data.TaggedError, whose `_tag` Match.tag and Match.exhaustive can see.
  //   NG: class StudioState { … } / errors: class NotFound extends Error {}
  //   OK: errors/index.ts: class UnknownTableError extends Data.TaggedError("UnknownTableError")<{ … }> {}
  "no-class": {
    meta: { docs: { description: "classes only as Data.TaggedError in errors/" } },
    create(context) {
      const filename = getFilename(context);
      if (TEST_FILE.test(filename)) return {};
      const inErrors = layerOf(filename) === "errors";
      function isTaggedError(node) {
        const sup = node.superClass;
        return (
          sup?.type === "CallExpression" &&
          sup.callee.type === "MemberExpression" &&
          sup.callee.object.type === "Identifier" &&
          sup.callee.object.name === "Data" &&
          sup.callee.property.type === "Identifier" &&
          sup.callee.property.name === "TaggedError"
        );
      }
      function check(node) {
        if (inErrors && isTaggedError(node)) return;
        context.report({
          node,
          message: inErrors
            ? "Classes in errors/ extend `Data.TaggedError('Name')`, so the failure has a `_tag` Match.tag and Match.exhaustive can see."
            : "Do not declare classes here. Use plain objects for data and functions for behaviour; the only classes are the failures in errors/ (Data.TaggedError).",
        });
      }
      return { ClassDeclaration: check, ClassExpression: check };
    },
  },

  // Why: one shape for every layer function: at most one argument, an object named `input`.
  //      Fields have names, so they can never be passed in the wrong order, and a new field does
  //      not change every call.
  //   NG: export function runSql(sql: string, params: readonly CellValue[])
  //   OK: export function runSql(input: { readonly sql: string; readonly params: readonly CellValue[] })
  //   OK: export function readStatus()
  "layer-function-shape": {
    meta: {
      docs: { description: "layer functions take at most one argument, an object named input" },
    },
    create(context) {
      const filename = getFilename(context);
      if (TEST_FILE.test(filename) || INDEX_FILE.test(filename)) return {};
      function check(name, fn, node) {
        if (fn === null || fn === undefined) return;
        const [first, ...rest] = fn.params;
        if (first === undefined) return;
        const target = first.type === "AssignmentPattern" ? first.left : first;
        if (rest.length === 0 && target.type === "Identifier" && target.name === "input") return;
        context.report({
          node,
          message: `\`${name}\` must take at most one argument, an object named \`input\` (\`${name}(input: { readonly … })\`). Named fields cannot be passed in the wrong order.`,
        });
      }
      return {
        ExportNamedDeclaration(node) {
          const declaration = node.declaration;
          if (declaration?.type === "FunctionDeclaration" && declaration.id) {
            check(declaration.id.name, declaration, declaration.id);
          }
          if (declaration?.type === "VariableDeclaration") {
            for (const d of declaration.declarations) {
              if (
                d.id.type === "Identifier" &&
                (d.init?.type === "ArrowFunctionExpression" ||
                  d.init?.type === "FunctionExpression")
              ) {
                check(d.id.name, d.init, d.id);
              }
            }
          }
        },
      };
    },
  },

  // Why: the layer's namespace (`import * as DbUseCase`) reads as the layer itself.
  //   NG: const dbUseCase = … / import * as parseService from "../services/parse.js"
  //   OK: import * as ParseService from "../services/parse.js"
  "layer-suffix-pascal-case": {
    meta: { docs: { description: "*UseCase / *Service / *Domain names start uppercase" } },
    create(context) {
      function check(id) {
        if (!LAYER_SUFFIX.test(id.name) || /^[A-Z]/u.test(id.name)) return;
        context.report({
          node: id,
          message: `\`${id.name}\` ends with a layer suffix, so it starts with an uppercase letter.`,
        });
      }
      return {
        VariableDeclarator(node) {
          if (node.id.type === "Identifier") check(node.id);
        },
        FunctionDeclaration(node) {
          if (node.id) check(node.id);
        },
        ImportNamespaceSpecifier(node) {
          check(node.local);
        },
      };
    },
  },

  // Why: one naming style for logic: camelCase for functions and variables, UPPER_SNAKE for
  //      constants. PascalCase is left to types, classes, React components, schemas and layers.
  //   NG: function Read_rows() {} / const max_rows = 100
  //   OK: function readRows() {} / const MAX_ROWS = 100
  "logic-camel-case": {
    meta: { docs: { description: "functions and variables are camelCase; constants UPPER_SNAKE" } },
    create(context) {
      // React components and declaration files name values in PascalCase.
      if (/\.(tsx|d\.ts)$/u.test(getFilename(context))) return {};
      function check(id, allowPascal) {
        if (LAYER_SUFFIX.test(id.name)) return;
        if (CAMEL_CASE.test(id.name) || UPPER_SNAKE.test(id.name)) return;
        if (allowPascal && PASCAL_CASE.test(id.name)) return;
        if (/^_/u.test(id.name)) return;
        context.report({
          node: id,
          message: `\`${id.name}\` must be camelCase (functions and variables) or UPPER_SNAKE (constants).`,
        });
      }
      // Schemas (`DocsSchema`), React components and Effect Context tags are PascalCase values.
      function pascalAllowed(init) {
        if (!init) return false;
        return (
          init.type === "CallExpression" ||
          // an alias of a component or a constructor: `const Icon = ICONS[kind]`, `const Client = pg.Client`
          init.type === "MemberExpression" ||
          init.type === "ArrowFunctionExpression" ||
          init.type === "FunctionExpression" ||
          init.type === "ClassExpression"
        );
      }
      return {
        VariableDeclarator(node) {
          if (node.id.type === "Identifier") check(node.id, pascalAllowed(node.init));
        },
        FunctionDeclaration(node) {
          // A function returning JSX is a React component.
          if (node.id) check(node.id, true);
        },
      };
    },
  },
};
