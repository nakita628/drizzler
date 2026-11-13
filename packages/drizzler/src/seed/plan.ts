import { Effect } from "effect";
import { SeedGenerationError } from "./errors.js";
import type { ForeignKey, ModelTable } from "./schema.js";

type Visit = {
  readonly order: readonly string[];
  readonly done: ReadonlySet<string>;
  readonly cycle: string | null;
};

/** A model on the DFS path, and whether the key that led to it was optional. */
type Frame = { readonly name: string; readonly optional: boolean };

/**
 * Models in insert order: every model after the models its keys point at.
 *
 * A cycle that runs through an optional key is broken there: the model that owns the optional
 * key is inserted first with that key null, so the models it points at can come after it. A cycle
 * made of required keys only cannot be inserted in any order and is reported.
 */
function orderModels(tables: readonly ModelTable[]) {
  const byName = new Map(tables.map((table) => [table.name, table] as const));
  function visitDependencies(
    dependencies: readonly ForeignKey[],
    stack: readonly Frame[],
    state: Visit,
  ): Visit & { readonly deferred: boolean } {
    const [fk, ...rest] = dependencies;
    if (fk === undefined || state.cycle !== null) return { ...state, deferred: false };
    const at = stack.findIndex((frame) => frame.name === fk.toModel);
    if (at === -1) {
      return visitDependencies(rest, stack, visit(fk.toModel, !fk.required, stack, state));
    }
    if (!fk.required) return visitDependencies(rest, stack, state);
    // A required key back into the path: fine when the path got here over an optional key,
    // which is seeded null; fatal when every key on the way is required.
    if (stack.slice(at + 1).some((frame) => frame.optional)) {
      return { ...state, deferred: true };
    }
    const names = [...stack.slice(at).map((frame) => frame.name), fk.toModel];
    return { order: state.order, done: state.done, cycle: names.join(" -> "), deferred: false };
  }
  function visit(name: string, optional: boolean, stack: readonly Frame[], state: Visit): Visit {
    if (state.cycle !== null || state.done.has(name)) return state;
    const table = byName.get(name);
    if (table === undefined) return state;
    const dependencies = table.foreignKeys
      .filter((fk) => !fk.self)
      .toSorted((a, b) => Number(b.required) - Number(a.required));
    const visited = visitDependencies(dependencies, [...stack, { name, optional }], state);
    if (visited.cycle !== null) return visited;
    // Deferred: a model up the path must be inserted first; this one is placed by a later visit.
    if (visited.deferred) return { order: visited.order, done: visited.done, cycle: null };
    return {
      order: [...visited.order, name],
      done: new Set([...visited.done, name]),
      cycle: null,
    };
  }
  function visitAll(names: readonly string[], state: Visit): Visit {
    const [name, ...rest] = names;
    return name === undefined ? state : visitAll(rest, visit(name, false, [], state));
  }
  return visitAll(
    tables.map((table) => table.name),
    { order: [], done: new Set(), cycle: null },
  );
}

/** The tables to seed, in an order every key can be satisfied in: parents before children. */
export function makeSeedPlan(tables: readonly ModelTable[]) {
  return Effect.gen(function* () {
    const visited = orderModels(tables);
    if (visited.cycle !== null) {
      return yield* new SeedGenerationError({
        message: `Required relations form a cycle: ${visited.cycle}.\n   Make one of them nullable so the seeder can insert the models in order.`,
      });
    }
    return visited.order.flatMap((name) => tables.filter((table) => table.name === name));
  });
}
