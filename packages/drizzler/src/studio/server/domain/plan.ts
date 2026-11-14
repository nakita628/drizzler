/**
 * The execution plans the databases print, read into one shape: the steps, parents first. What a
 * driver hands back is checked here, so the rest of the studio reads plain data. JSON text is
 * parsed by the caller (JSON.parse throws), so these functions only take values.
 */
import * as z from "zod";
import { Dialect } from "./sql.js";

const PlanNode = z
  .object({
    id: z.string().meta({ description: "The step id.", example: "3" }),
    parent: z.string().nullable().meta({ description: "The parent step id.", example: null }),
    label: z.string().meta({ description: "What the step does.", example: "SCAN users" }),
    detail: z.string().nullable().meta({ description: "The rest of the line.", example: null }),
    cost: z.number().nullable().meta({ description: "The estimated cost.", example: null }),
    rows: z.number().nullable().meta({ description: "The estimated rows.", example: null }),
  })
  .meta({ description: "One step of an execution plan, flattened" });

const SqliteRow = z
  .object({
    id: z.coerce.number().meta({ description: "The step id.", example: 3 }),
    parent: z.coerce
      .number()
      .meta({ description: "The parent step id, 0 for a root.", example: 0 }),
    detail: z.string().meta({ description: "What the step does.", example: "SCAN users" }),
  })
  .meta({ description: "A row of EXPLAIN QUERY PLAN" });

const MakeSqlitePlanInput = z
  .object({
    rows: z
      .array(z.record(z.string(), z.unknown()))
      .readonly()
      .meta({ description: "The rows EXPLAIN QUERY PLAN returned." }),
  })
  .readonly()
  .meta({ description: "The output of SQLite EXPLAIN QUERY PLAN" });

/**
 * Reads SQLite's `EXPLAIN QUERY PLAN` rows (`id`, `parent`, 0 for a root, and `detail`) into
 * the plan's steps. Rows that are not of that shape are left out.
 *
 * ```mermaid
 * flowchart LR
 *   rows[input.rows from the database] --> check[check each row's shape]
 *   check --> steps[steps: id, parent, label]
 * ```
 *
 * @param input - the rows EXPLAIN QUERY PLAN returned
 * @returns the steps, parents first, and the plan as indented text, as SQLite's shell prints it
 * @example
 * ```ts
 * makeSqlitePlan({ rows: [{ id: 2, parent: 0, notused: 0, detail: "SCAN users" }] }).nodes;
 * // => [{ id: "2", parent: null, label: "SCAN users", detail: null, cost: null, rows: null }]
 * ```
 */
export function makeSqlitePlan(input: z.infer<typeof MakeSqlitePlanInput>) {
  const rows = input.rows.flatMap((row) => {
    const result = SqliteRow.safeParse(row);
    return result.success ? [result.data] : [];
  });
  const ids = new Set(rows.map((row) => row.id));
  const nodes: readonly z.infer<typeof PlanNode>[] = rows.map((row) => ({
    id: String(row.id),
    parent: row.parent === 0 || !ids.has(row.parent) ? null : String(row.parent),
    label: row.detail,
    detail: null,
    cost: null,
    rows: null,
  }));
  return {
    nodes,
    raw: rows.map((row) => `${"  ".repeat(depthOf(rows, row.id))}${row.detail}`).join("\n"),
  };
}

function depthOf(rows: readonly z.infer<typeof SqliteRow>[], id: number): number {
  const row = rows.find((candidate) => candidate.id === id);
  if (row === undefined || row.parent === 0) return 0;
  return 1 + depthOf(rows, row.parent);
}

const PostgresPlan = z
  .object({
    "Node Type": z.string().meta({ description: "The operator.", example: "Seq Scan" }),
    "Relation Name": z.string().optional().meta({ description: "The table.", example: "users" }),
    Alias: z.string().optional().meta({ description: "The alias.", example: "u" }),
    "Index Name": z.string().optional().meta({ description: "The index.", example: "users_pkey" }),
    "Join Type": z.string().optional().meta({ description: "Inner, Left, ...", example: "Inner" }),
    "Total Cost": z.number().optional().meta({ description: "The estimated cost.", example: 1.5 }),
    "Plan Rows": z.number().optional().meta({ description: "The estimated rows.", example: 10 }),
    "Actual Rows": z.number().optional().meta({ description: "The rows seen.", example: 10 }),
    Filter: z.string().optional().meta({ description: "The filter.", example: "(id = 1)" }),
    "Join Filter": z.string().optional().meta({ description: "The join filter.", example: "" }),
    "Hash Cond": z.string().optional().meta({ description: "The hash condition.", example: "" }),
    "Merge Cond": z.string().optional().meta({ description: "The merge condition.", example: "" }),
    "Index Cond": z.string().optional().meta({ description: "The index condition.", example: "" }),
    "Sort Key": z.array(z.string()).optional().meta({ description: "The sort keys." }),
    "Group Key": z.array(z.string()).optional().meta({ description: "The group keys." }),
    "CTE Name": z.string().optional().meta({ description: "The CTE.", example: "c" }),
    "Subplan Name": z.string().optional().meta({ description: "The subplan.", example: "" }),
    Plans: z.array(z.unknown()).optional().meta({ description: "The child plans." }),
  })
  .meta({ description: "One node of PostgreSQL EXPLAIN (FORMAT JSON)" });

const PostgresRoot = z
  .array(z.object({ Plan: z.unknown().meta({ description: "The root plan." }) }))
  .meta({ description: "The document EXPLAIN (FORMAT JSON) returns" });

function postgresDetail(plan: z.infer<typeof PostgresPlan>) {
  const parts = [
    plan["Index Name"] === undefined ? null : `using ${plan["Index Name"]}`,
    plan["Index Cond"] === undefined ? null : `Index Cond: ${plan["Index Cond"]}`,
    plan["Hash Cond"] === undefined ? null : `Hash Cond: ${plan["Hash Cond"]}`,
    plan["Merge Cond"] === undefined ? null : `Merge Cond: ${plan["Merge Cond"]}`,
    plan["Join Filter"] === undefined ? null : `Join Filter: ${plan["Join Filter"]}`,
    plan.Filter === undefined ? null : `Filter: ${plan.Filter}`,
    plan["Sort Key"] === undefined ? null : `Sort Key: ${plan["Sort Key"].join(", ")}`,
    plan["Group Key"] === undefined ? null : `Group Key: ${plan["Group Key"].join(", ")}`,
  ].filter((part) => part !== null);
  return parts.length === 0 ? null : parts.join(" · ");
}

function flattenPostgres(
  value: unknown,
  parent: string | null,
  id: string,
): readonly z.infer<typeof PlanNode>[] {
  const result = PostgresPlan.safeParse(value);
  if (!result.success) return [];
  const plan = result.data;
  const target = plan["Relation Name"] ?? plan["CTE Name"];
  const alias = plan.Alias !== undefined && plan.Alias !== target ? ` ${plan.Alias}` : "";
  const join = plan["Join Type"] === undefined ? "" : ` (${plan["Join Type"]})`;
  const label = `${plan["Node Type"]}${target === undefined ? "" : ` on ${target}${alias}`}${join}`;
  const node = {
    id,
    parent,
    label: plan["Subplan Name"] === undefined ? label : `${plan["Subplan Name"]}: ${label}`,
    detail: postgresDetail(plan),
    cost: plan["Total Cost"] ?? null,
    rows: plan["Actual Rows"] ?? plan["Plan Rows"] ?? null,
  };
  return [
    node,
    ...(plan.Plans ?? []).flatMap((child, index) =>
      flattenPostgres(child, id, `${id}.${index + 1}`),
    ),
  ];
}

const MakePostgresPlanInput = z
  .object({
    document: z
      .unknown()
      .meta({ description: "The JSON document of the QUERY PLAN column, parsed." }),
  })
  .readonly()
  .meta({ description: "The output of PostgreSQL EXPLAIN (FORMAT JSON)" });

/**
 * Reads PostgreSQL's `EXPLAIN (FORMAT JSON)` document, a tree of `Plan` objects, into the plan's
 * steps, flattened parents first, with each step's estimated cost and rows.
 *
 * ```mermaid
 * flowchart LR
 *   doc[input.document: the parsed JSON] --> check[check the Plan tree's shape]
 *   check --> flat[flatten parents first]
 *   flat --> steps[steps + raw JSON]
 * ```
 *
 * @param input - the document the database returned, parsed (see makePlanDocument)
 * @returns the steps (none when the document is not a plan) and the document as JSON text
 * @example
 * ```ts
 * makePostgresPlan({ document: [{ Plan: { "Node Type": "Seq Scan", "Relation Name": "users" } }] }).nodes[0].label;
 * // => "Seq Scan on users"
 * ```
 */
export function makePostgresPlan(input: z.infer<typeof MakePostgresPlanInput>) {
  const { document } = input;
  const result = PostgresRoot.safeParse(document);
  const nodes = result.success
    ? result.data.flatMap((entry, index) => flattenPostgres(entry.Plan, null, String(index + 1)))
    : [];
  return { nodes, raw: JSON.stringify(document, null, 2) };
}

const MysqlTable = z
  .object({
    table_name: z.string().meta({ description: "The table.", example: "users" }),
    access_type: z.string().optional().meta({ description: "The access type.", example: "ALL" }),
    key: z.string().optional().meta({ description: "The index used.", example: "PRIMARY" }),
    rows_examined_per_scan: z
      .number()
      .optional()
      .meta({ description: "Rows per scan.", example: 3 }),
    rows_produced_per_join: z
      .number()
      .optional()
      .meta({ description: "Rows produced.", example: 3 }),
    attached_condition: z.string().optional().meta({ description: "The condition.", example: "" }),
    cost_info: z
      .object({
        read_cost: z.string().optional().meta({ description: "Read cost.", example: "1" }),
        prefix_cost: z.string().optional().meta({ description: "Prefix cost.", example: "1" }),
      })
      .optional()
      .meta({ description: "The cost figures." }),
  })
  .meta({ description: "A `table` entry of MySQL EXPLAIN FORMAT=JSON" });

const MysqlBlock = z
  .object({
    select_id: z.number().optional().meta({ description: "The select id.", example: 1 }),
    cost_info: z
      .object({
        query_cost: z.string().optional().meta({ description: "The query cost.", example: "1" }),
      })
      .optional()
      .meta({ description: "The cost figures." }),
    message: z.string().optional().meta({ description: "A note instead of a plan.", example: "" }),
  })
  .meta({ description: "A `query_block` entry of MySQL EXPLAIN FORMAT=JSON" });

const MYSQL_OPERATIONS = new Set([
  "ordering_operation",
  "grouping_operation",
  "duplicates_removal",
  "windowing",
  "nested_loop",
  "table",
  "query_block",
  "materialized_from_subquery",
  "union_result",
  "query_specifications",
  "subqueries",
  "optimized_away_subqueries",
  "attached_subqueries",
  "buffer_result",
]);

function flattenMysql(
  value: unknown,
  parent: string | null,
  id: string,
  key: string,
): readonly z.infer<typeof PlanNode>[] {
  if (Array.isArray(value)) {
    // `nested_loop` and its kin hold one entry per input; the array is the operation, its entries feed it.
    const node = {
      id,
      parent,
      label: key.replaceAll("_", " "),
      detail: null,
      cost: null,
      rows: null,
    };
    return [
      node,
      ...value.flatMap((item, index) => childrenOfMysql(item, id, `${id}.${index + 1}`)),
    ];
  }
  if (typeof value !== "object" || value === null) return [];
  if (key === "table") {
    const result = MysqlTable.safeParse(value);
    if (!result.success) return [];
    const parts = [
      result.data.key === undefined ? null : `key ${result.data.key}`,
      result.data.attached_condition ?? null,
    ].filter((part) => part !== null);
    const node = {
      id,
      parent,
      label: `${result.data.access_type ?? "scan"} ${result.data.table_name}`,
      detail: parts.length === 0 ? null : parts.join(" · "),
      cost:
        Number(
          result.data.cost_info?.prefix_cost ?? result.data.cost_info?.read_cost ?? Number.NaN,
        ) || null,
      rows: result.data.rows_produced_per_join ?? result.data.rows_examined_per_scan ?? null,
    };
    return [node, ...childrenOfMysql(value, id, id)];
  }
  if (key === "query_block") {
    const result = MysqlBlock.safeParse(value);
    const node = {
      id,
      parent,
      label:
        result.success && result.data.select_id !== undefined
          ? `query block #${result.data.select_id}`
          : "query block",
      detail: result.success ? (result.data.message ?? null) : null,
      cost: result.success ? Number(result.data.cost_info?.query_cost ?? Number.NaN) || null : null,
      rows: null,
    };
    return [node, ...childrenOfMysql(value, id, id)];
  }
  if (MYSQL_OPERATIONS.has(key)) {
    const node = {
      id,
      parent,
      label: key.replaceAll("_", " "),
      detail: null,
      cost: null,
      rows: null,
    };
    return [node, ...childrenOfMysql(value, id, id)];
  }
  return childrenOfMysql(value, parent, id);
}

/** The operations nested in an object, numbered under `base` (`1.2` → `1.2.1`, `1.2.2`, ...). */
function childrenOfMysql(
  value: unknown,
  parent: string | null,
  base: string,
): readonly z.infer<typeof PlanNode>[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];
  const result = z.record(z.string(), z.unknown()).safeParse(value);
  if (!result.success) return [];
  return Object.entries(result.data)
    .filter(
      ([key, child]) => typeof child === "object" && child !== null && MYSQL_OPERATIONS.has(key),
    )
    .flatMap(([key, child], index) =>
      flattenMysql(child, parent, base === "" ? String(index + 1) : `${base}.${index + 1}`, key),
    );
}

const MakeMysqlPlanInput = z
  .object({
    document: z.unknown().meta({ description: "The JSON document of the EXPLAIN column, parsed." }),
  })
  .readonly()
  .meta({ description: "The output of MySQL EXPLAIN FORMAT=JSON" });

/**
 * Reads MySQL's `EXPLAIN FORMAT=JSON` document, nested operation objects, into the plan's
 * steps, flattened parents first.
 *
 * ```mermaid
 * flowchart LR
 *   doc[input.document: the parsed JSON] --> walk[walk the nested operations]
 *   walk --> steps[steps numbered 1, 1.1, 1.2 ... + raw JSON]
 * ```
 *
 * @param input - the document the database returned, parsed (see makePlanDocument)
 * @returns the steps (none when the document is not a plan) and the document as JSON text
 * @example
 * ```ts
 * makeMysqlPlan({ document: { query_block: { table: { table_name: "users", access_type: "ALL" } } } }).nodes.map((n) => n.label);
 * // => ["query block", "ALL users"]
 * ```
 */
export function makeMysqlPlan(input: z.infer<typeof MakeMysqlPlanInput>) {
  const { document } = input;
  const nodes = childrenOfMysql(document, null, "");
  return { nodes, raw: JSON.stringify(document, null, 2) };
}

const EXPLAIN_OUTPUT = {
  dialect: Dialect,
  rows: z
    .array(z.record(z.string(), z.unknown()))
    .readonly()
    .meta({ description: "The rows EXPLAIN returned." }),
} as const;

const MakePlanDocumentInput = z
  .object(EXPLAIN_OUTPUT)
  .readonly()
  .meta({ description: "What EXPLAIN returned" });

/**
 * The JSON document of a PostgreSQL or MySQL plan, as the driver handed it back: a value, or JSON
 * text the caller parses before makePlan. SQLite's plan is its rows, so it has none.
 *
 * @param input - the `dialect` and the `rows` EXPLAIN returned
 * @returns the `QUERY PLAN` (PostgreSQL) or `EXPLAIN` (MySQL) column of the first row; null for SQLite or no row
 * @example
 * ```ts
 * makePlanDocument({ dialect: "mysql", rows: [{ EXPLAIN: '{"query_block":{}}' }] });
 * // => '{"query_block":{}}'
 * ```
 */
export function makePlanDocument(input: z.infer<typeof MakePlanDocumentInput>): unknown {
  const first = input.rows[0];
  if (input.dialect === "postgresql") return first?.["QUERY PLAN"] ?? null;
  if (input.dialect === "mysql") return first?.["EXPLAIN"] ?? null;
  return null;
}

const MakePlanInput = z
  .object({
    ...EXPLAIN_OUTPUT,
    document: z
      .unknown()
      .meta({ description: "makePlanDocument's document, parsed when it was text." }),
  })
  .readonly()
  .meta({ description: "What EXPLAIN returned, with its JSON document parsed" });

/**
 * The plan's steps for the dialect: SQLite's from its rows, PostgreSQL's and MySQL's from their
 * JSON document.
 *
 * @param input - the `dialect`, the `rows` EXPLAIN returned and the parsed `document`
 * @returns the steps and the raw plan as text
 * @example
 * ```ts
 * makePlan({ dialect: "postgresql", rows: [], document: [{ Plan: { "Node Type": "Result" } }] }).nodes[0].label;
 * // => "Result"
 * ```
 */
export function makePlan(input: z.infer<typeof MakePlanInput>) {
  const { dialect } = input;
  if (dialect === "postgresql") return makePostgresPlan({ document: input.document });
  if (dialect === "mysql") return makeMysqlPlan({ document: input.document });
  return makeSqlitePlan({ rows: input.rows });
}
