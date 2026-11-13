// Performance rules: work that runs once per item of a loop and grows with another collection, or
// that gives the same answer on every turn. Each catches a shape that was found slow in practice
// (a lookup per row, a copied accumulator, a set rebuilt per edge) before it needs a profiler.
//
//   no-lookup-in-loop          a linear search (find / filter / includes / ...) of a collection
//                              from outside the loop, on every turn: O(n × m)
//   no-accumulator-copy        a reduce that copies its accumulator (or a part of it) each step:
//                              O(n²)
//   no-invariant-construction  a RegExp / Set / Map built inside a loop from values that do not
//                              change in it: the same object made on every turn
//
// "A loop" is a for / for-of / for-in / while body, or the callback of an array method that
// visits every item (map, filter, reduce, some, a sort comparator, ...). Something the loop
// declares (a callback parameter, a const inside it) changes per turn; anything else does not.
// A case that is inherent to the problem (every wire against every card it may cross) is kept
// with a disable comment that says why.

import { TEST_FILE, getFilename } from "./helpers.js";

// Array methods whose callback runs once per item (or per comparison).
const ITERATING = new Set([
  "map",
  "flatMap",
  "filter",
  "forEach",
  "reduce",
  "reduceRight",
  "some",
  "every",
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "toSorted",
  "sort",
  "groupBy",
]);

// Methods that scan an array from the start until they find what they look for.
const LOOKUP = new Set([
  "find",
  "findIndex",
  "findLast",
  "findLastIndex",
  "filter",
  "some",
  "every",
  "includes",
  "indexOf",
  "lastIndexOf",
]);

const LOOP_STATEMENTS = new Set([
  "ForStatement",
  "ForOfStatement",
  "ForInStatement",
  "WhileStatement",
  "DoWhileStatement",
]);

const FUNCTIONS = new Set(["ArrowFunctionExpression", "FunctionExpression", "FunctionDeclaration"]);

const CONSTRUCTED = new Set(["RegExp", "Set", "Map"]);

// Methods that change the collection they are called on.
const MUTATING = new Set([
  "set",
  "add",
  "delete",
  "clear",
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
]);

// Whether a node sits in the arguments of `new XxxError(...)`: built once, on the way out.
function inError(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (FUNCTIONS.has(current.type)) return false;
    if (
      current.type === "NewExpression" &&
      current.callee.type === "Identifier" &&
      current.callee.name.endsWith("Error")
    ) {
      return true;
    }
  }
  return false;
}

function methodName(callee) {
  if (callee?.type !== "MemberExpression" || callee.computed) return null;
  return callee.property.type === "Identifier" ? callee.property.name : null;
}

// Whether a function is the callback of an iterating array method (`xs.map(fn)`, `Map.groupBy(xs,
// fn)`).
function isIteratingCallback(fn) {
  const call = fn.parent;
  if (call?.type !== "CallExpression" || !call.arguments.includes(fn)) return false;
  const name = methodName(call.callee);
  return name !== null && ITERATING.has(name);
}

// The nearest loop around a node: a loop statement, or the callback of an iterating method. A
// plain function in between ends the search: it runs when it is called, not per turn.
function enclosingLoop(node) {
  for (
    let current = node.parent, child = node;
    current;
    child = current, current = current.parent
  ) {
    // The iterable of a for-of / for-in and the init of a for are evaluated once.
    if (LOOP_STATEMENTS.has(current.type)) {
      if (child === current.right || child === current.init) continue;
      return current;
    }
    if (FUNCTIONS.has(current.type)) {
      if (isIteratingCallback(current)) return current;
      return null;
    }
  }
  return null;
}

// The names a binding pattern introduces.
function patternNames(pattern) {
  if (!pattern) return [];
  switch (pattern.type) {
    case "Identifier":
      return [pattern.name];
    case "ObjectPattern":
      return pattern.properties.flatMap((p) =>
        p.type === "RestElement" ? patternNames(p.argument) : patternNames(p.value),
      );
    case "ArrayPattern":
      return pattern.elements.flatMap(patternNames);
    case "RestElement":
      return patternNames(pattern.argument);
    case "AssignmentPattern":
      return patternNames(pattern.left);
    case "TSParameterProperty":
      return patternNames(pattern.parameter);
    default:
      return [];
  }
}

// Every name declared inside a loop: what changes from one turn to the next.
function boundIn(loop) {
  const names = new Set();
  function visit(node) {
    if (!node || typeof node.type !== "string") return;
    if (FUNCTIONS.has(node.type)) {
      for (const param of node.params) for (const name of patternNames(param)) names.add(name);
      if (node.id) names.add(node.id.name);
    }
    if (node.type === "VariableDeclarator") {
      for (const name of patternNames(node.id)) names.add(name);
    }
    if (node.type === "CatchClause") {
      for (const name of patternNames(node.param)) names.add(name);
    }
    // A collection the loop fills, or a variable it reassigns, changes from turn to turn too.
    if (node.type === "CallExpression" && MUTATING.has(methodName(node.callee))) {
      const root = rootName(node.callee.object);
      if (root !== null) names.add(root);
    }
    if (node.type === "AssignmentExpression" || node.type === "UpdateExpression") {
      const root = rootName(node.left ?? node.argument);
      if (root !== null) names.add(root);
    }
    for (const key of Object.keys(node)) {
      if (key === "parent") continue;
      const child = node[key];
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child.type === "string") visit(child);
    }
  }
  visit(loop);
  return names;
}

// The identifiers an expression reads, except property names (`a.b` reads `a`, not `b`).
function readNames(node) {
  if (!node || typeof node.type !== "string") return [];
  if (node.type === "Identifier") return [node.name];
  if (node.type === "MemberExpression") {
    return [...readNames(node.object), ...(node.computed ? readNames(node.property) : [])];
  }
  if (node.type === "Property") {
    return [...(node.computed ? readNames(node.key) : []), ...readNames(node.value)];
  }
  if (FUNCTIONS.has(node.type)) return [node.type];
  return Object.keys(node)
    .filter((key) => key !== "parent")
    .flatMap((key) => {
      const child = node[key];
      if (Array.isArray(child)) return child.flatMap(readNames);
      return child && typeof child.type === "string" ? readNames(child) : [];
    });
}

// The variable a member chain starts from (`model.fields` → `model`, `Object.entries(columns)` →
// `columns`), or null when it starts from another call or a literal.
function rootName(node) {
  if (node.type === "Identifier") return node.name;
  if (node.type === "CallExpression" && isObjectView(node.callee) && node.arguments[0]) {
    return rootName(node.arguments[0]);
  }
  if (node.type === "MemberExpression") return rootName(node.object);
  if (node.type === "ChainExpression" || node.type === "TSNonNullExpression") {
    return rootName(node.expression);
  }
  return null;
}

// `Object.entries` / `Object.keys` / `Object.values`: a view of an object, searched as a list.
function isObjectView(callee) {
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.object.type === "Identifier" &&
    callee.object.name === "Object" &&
    callee.property.type === "Identifier" &&
    ["entries", "keys", "values"].includes(callee.property.name)
  );
}

// Loops are walked once per file, however many calls sit inside them.
function boundNames(cache, loop) {
  const known = cache.get(loop);
  if (known) return known;
  const names = boundIn(loop);
  cache.set(loop, names);
  return names;
}

// Lookups that take the value sought rather than a predicate.
const VALUE_LOOKUP = new Set(["includes", "indexOf", "lastIndexOf"]);

// What a predicate returns: an arrow's expression, or the argument of a body's only `return`.
function predicateOf(fn) {
  if (fn.body.type !== "BlockStatement") return fn.body;
  const [only, ...rest] = fn.body.body;
  return rest.length === 0 && only?.type === "ReturnStatement" ? only.argument : null;
}

// The `a === b` pairs an `&&` chain is made of (`!(a === b)` aside: a negated key is no index).
function comparisons(node) {
  if (!node) return [];
  if (node.type === "LogicalExpression" && node.operator === "&&") {
    return [...comparisons(node.left), ...comparisons(node.right)];
  }
  if (node.type === "BinaryExpression" && (node.operator === "===" || node.operator === "==")) {
    return [[node.left, node.right]];
  }
  return [];
}

// Whether an expression reads the predicate's own parameters and nothing else.
function readsOnly(node, own) {
  const names = readNames(node);
  return names.length > 0 && names.every((n) => own.has(n));
}

// Whether an expression reads something the loop declares, and none of the predicate's own.
function readsLoop(node, own, bound) {
  const names = readNames(node);
  return names.some((n) => bound.has(n)) && !names.some((n) => own.has(n));
}

export const perfRules = {
  // Why: looking an item up by key in another collection on every turn makes the loop O(n × m);
  //      with hundreds of tables and columns that is the difference between milliseconds and
  //      seconds. Index the collection once, before the loop, and look items up by key. Only a
  //      lookup by equality is reported: a search by overlap or range (a box against the cards
  //      it may cross) has no key to index by.
  //   NG: models.map((m) => relations.find((r) => r.to === m.name))
  //   NG: names.filter((name) => !taken.includes(name))
  //   OK: const byTarget = new Map(relations.map((r) => [r.to, r]))
  //       models.map((m) => byTarget.get(m.name))
  //   OK: models.map((m) => m.fields.find((f) => f.isId))   // searches the item's own list
  "no-lookup-in-loop": {
    meta: { docs: { description: "no lookup by key in an outer collection inside a loop" } },
    create(context) {
      if (TEST_FILE.test(getFilename(context))) return {};
      const cache = new Map();
      function report(node, root, name) {
        context.report({
          node,
          message: `\`${root}….${name}()\` looks an item up by key in a collection from outside the loop, on every turn: O(n × m). Index it once before the loop (\`new Map(xs.map((x) => [x.key, x]))\`, \`Map.groupBy\`, \`new Set(xs)\`) and look items up with \`.get\` / \`.has\`.`,
        });
      }
      return {
        CallExpression(node) {
          const name = methodName(node.callee);
          if (name === null || !LOOKUP.has(name)) return;
          const root = rootName(node.callee.object);
          if (root === null) return;
          const loop = enclosingLoop(node);
          if (loop === null) return;
          const bound = boundNames(cache, loop);
          if (bound.has(root)) return;
          const [first] = node.arguments;
          if (VALUE_LOOKUP.has(name)) {
            // `xs.includes(item.key)`: the value sought changes per turn.
            if (first && readNames(first).some((n) => bound.has(n))) report(node, root, name);
            return;
          }
          if (!first || !FUNCTIONS.has(first.type)) return;
          const own = new Set(first.params.flatMap(patternNames));
          const keyed = comparisons(predicateOf(first)).some(([a, b]) =>
            [
              [a, b],
              [b, a],
            ].some(([item, key]) => readsOnly(item, own) && readsLoop(key, own, bound)),
          );
          if (keyed) report(node, root, name);
        },
      };
    },
  },

  // Why: a reduce that spreads its accumulator copies everything gathered so far on every step,
  //      O(n²) in all. oxc/no-accumulating-spread catches `[...acc, x]`; this also catches a part
  //      of it (`{ ...state, rows: [...state.rows, row] }`) and a destructured one.
  //   NG: items.reduce((state, x) => ({ next: state.next + 1, rows: [...state.rows, x] }), init)
  //   OK: items.map((x, index) => ({ index, x }))   /  Object.fromEntries / Map.groupBy
  "no-accumulator-copy": {
    meta: { docs: { description: "no copying a reduce accumulator on every step" } },
    create(context) {
      if (TEST_FILE.test(getFilename(context))) return {};
      return {
        SpreadElement(node) {
          const root = rootName(node.argument);
          if (root === null) return;
          for (let current = node.parent; current; current = current.parent) {
            if (!FUNCTIONS.has(current.type)) continue;
            const call = current.parent;
            const name = call?.type === "CallExpression" ? methodName(call.callee) : null;
            if ((name !== "reduce" && name !== "reduceRight") || call.arguments[0] !== current) {
              return;
            }
            if (!patternNames(current.params[0]).includes(root)) return;
            context.report({
              node,
              message: `Spreading \`${root}\`, the accumulator of this ${name}, copies everything gathered so far on every step (O(n²)). Build the list with map / flatMap / filter, an object with Object.fromEntries, groups with Map.groupBy, or carry only a small running value in the reduce.`,
            });
            return;
          }
        },
      };
    },
  },

  // Why: a RegExp, Set or Map built from values the loop does not change is the same object on
  //      every turn; building it once before the loop saves compiling or hashing it again.
  //   NG: rows.filter((row) => new Set(ids).has(row.id))
  //   OK: const wanted = new Set(ids)
  //       rows.filter((row) => wanted.has(row.id))
  "no-invariant-construction": {
    meta: {
      docs: { description: "no RegExp / Set / Map built from loop-invariant values in a loop" },
    },
    create(context) {
      if (TEST_FILE.test(getFilename(context))) return {};
      const cache = new Map();
      function check(node) {
        if (node.callee.type !== "Identifier" || !CONSTRUCTED.has(node.callee.name)) return;
        if (node.arguments.length === 0 || inError(node)) return;
        const loop = enclosingLoop(node);
        if (loop === null) return;
        const bound = boundNames(cache, loop);
        const reads = node.arguments.flatMap(readNames);
        if (reads.some((name) => bound.has(name) || FUNCTIONS.has(name))) return;
        context.report({
          node,
          message: `This ${node.callee.name} is built from values that do not change inside the loop, so the same one is made on every turn. Build it once before the loop and reuse it.`,
        });
      }
      return { NewExpression: check, CallExpression: check };
    },
  },
};
