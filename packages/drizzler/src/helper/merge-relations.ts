import { extractRelationsFromSchema } from "./extract-tables.js";

// Builds a single, render-agnostic list of ER relations consumed by both the
// Mermaid and DBML generators. Each relation keeps its cardinality structured
// (not pre-rendered to a symbol string) so each generator can map it to its own
// notation at the output boundary.
//
// `origin` records whether a physical FK backs the relation: a `.references()`
// or `foreignKey()` pair is `inferred`, a pair only `defineRelations`
// declares is `relations` (logical, no constraint in the database). A logical
// relation is non-identifying, so every output draws it dashed.
// How many child rows a parent has: at most one when the key column is a key of its own, and at
// least one when it is NOT NULL.
function childCardinality(relation: { readonly isUnique: boolean; readonly isRequired: boolean }) {
  if (relation.isUnique) return relation.isRequired ? "one" : "zero-one";
  return relation.isRequired ? "many" : "zero-many";
}

/** The schema's relations with their cardinalities, as every ER output draws them: from foreign keys and `defineRelations`. */
export function mergeRelations(code: readonly string[]) {
  // Parent side is exactly one; child side is one-or-more when the FK column is
  // NOT NULL, else zero-or-more; it is at most one when the FK column is a key of its
  // own. `as const` keeps the `cardinality` / `origin` literals from widening to `string`.
  return extractRelationsFromSchema(code).map(
    (r) =>
      ({
        from: { model: r.fromModel, field: r.fromField, cardinality: "one" },
        to: {
          model: r.toModel,
          field: r.toField,
          cardinality: childCardinality(r),
        },
        identifying: r.enforced,
        origin: r.enforced ? "inferred" : "relations",
      }) as const,
  );
}
