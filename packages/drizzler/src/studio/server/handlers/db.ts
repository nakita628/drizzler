import type { RouteHandler } from "@hono/zod-openapi";
import { Effect, Match } from "effect";
import type {
  deleteDbRowsTableNameRoute,
  getDbCountsRoute,
  getDbRoute,
  getDbRowsTableNameRoute,
  patchDbRowsTableNameRoute,
  postDbAnalyzeRoute,
  postDbExplainRoute,
  postDbRowsTableNameRoute,
  postDbSqlRoute,
} from "../routes";
import {
  AffectedSchema,
  AnalysisSchema,
  CountsSchema,
  DbStatusSchema,
  PlanSchema,
  RowsSchema,
  SqlResultSchema,
} from "../routes";
import * as DbUseCase from "../usecases/db.js";

/**
 * `GET /db` handler. The connection, and the tables of the saved schema.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant C as Client
 *   participant H as Handler
 *   participant U as DbUseCase
 *   C->>H: GET /db
 *   H->>U: readStatus()
 *   U-->>H: DbStatus
 *   H-->>C: 200 DbStatus
 *   Note over H: on failure, Match.tag: FileReadError -> 500
 * ```
 */
export const getDbRouteHandler: RouteHandler<typeof getDbRoute> = (c) => {
  return Effect.runPromise(
    Effect.matchEffect(DbUseCase.readStatus(), {
      onSuccess: (value) => Effect.succeed(c.json(DbStatusSchema.parse(value), 200)),
      onFailure: (error) =>
        Match.value(error).pipe(
          Match.tag("FileReadError", ({ path, cause }) =>
            Effect.logError("cannot read the schema", path, cause).pipe(
              Effect.as(
                c.json(
                  {
                    type: "/problems/internal-server-error",
                    title: "Internal Server Error",
                    status: 500,
                    detail: "An unexpected error occurred.",
                    instance: c.req.path,
                  } as const,
                  500,
                  { "Content-Type": "application/problem+json" },
                ),
              ),
            ),
          ),
          Match.exhaustive,
        ),
    }),
  );
};

/**
 * `GET /db/counts` handler. Row counts by table.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant C as Client
 *   participant H as Handler
 *   participant U as DbUseCase
 *   C->>H: GET /db/counts
 *   H->>U: readCounts()
 *   U-->>H: Counts
 *   H-->>C: 200 Counts
 *   Note over H: on failure, Match.tag: DatabaseUnavailableError -> 503, FileReadError -> 500
 * ```
 */
export const getDbCountsRouteHandler: RouteHandler<typeof getDbCountsRoute> = (c) => {
  return Effect.runPromise(
    Effect.matchEffect(DbUseCase.readCounts(), {
      onSuccess: (value) => Effect.succeed(c.json(CountsSchema.parse(value), 200)),
      onFailure: (error) =>
        Match.value(error).pipe(
          Match.tag("DatabaseUnavailableError", ({ reason }) =>
            Effect.succeed(
              c.json(
                {
                  type: "/problems/service-unavailable",
                  title: "Service Unavailable",
                  status: 503,
                  detail: reason,
                  instance: c.req.path,
                } as const,
                503,
                { "Content-Type": "application/problem+json" },
              ),
            ),
          ),
          Match.tag("FileReadError", ({ path, cause }) =>
            Effect.logError("cannot read the schema", path, cause).pipe(
              Effect.as(
                c.json(
                  {
                    type: "/problems/internal-server-error",
                    title: "Internal Server Error",
                    status: 500,
                    detail: "An unexpected error occurred.",
                    instance: c.req.path,
                  } as const,
                  500,
                  { "Content-Type": "application/problem+json" },
                ),
              ),
            ),
          ),
          Match.exhaustive,
        ),
    }),
  );
};

/**
 * `GET /db/rows/{tableName}` handler. One page of rows.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant C as Client
 *   participant H as Handler
 *   participant U as DbUseCase
 *   C->>H: GET /db/rows/{tableName}?skip&take&search
 *   H->>U: readRows({ table, skip, take, search })
 *   U-->>H: Rows
 *   H-->>C: 200 Rows
 *   Note over H: on failure, Match.tag: UnknownTableError -> 404, DatabaseUnavailableError -> 503, DatabaseError -> 503, FileReadError -> 500
 * ```
 */
export const getDbRowsTableNameRouteHandler: RouteHandler<typeof getDbRowsTableNameRoute> = (c) => {
  const data = { ...c.req.valid("param"), ...c.req.valid("query") };
  return Effect.runPromise(
    Effect.matchEffect(
      DbUseCase.readRows({
        table: data.tableName,
        skip: data.skip,
        take: data.take,
        search: data.search ?? "",
      }),
      {
        onSuccess: (value) => Effect.succeed(c.json(RowsSchema.parse(value), 200)),
        onFailure: (error) =>
          Match.value(error).pipe(
            Match.tag("UnknownTableError", ({ table }) =>
              Effect.succeed(
                c.json(
                  {
                    type: "/problems/not-found",
                    title: "Not Found",
                    status: 404,
                    detail: `Unknown table "${table}".`,
                    instance: c.req.path,
                  } as const,
                  404,
                  { "Content-Type": "application/problem+json" },
                ),
              ),
            ),
            Match.tag("DatabaseUnavailableError", ({ reason }) =>
              Effect.succeed(
                c.json(
                  {
                    type: "/problems/service-unavailable",
                    title: "Service Unavailable",
                    status: 503,
                    detail: reason,
                    instance: c.req.path,
                  } as const,
                  503,
                  { "Content-Type": "application/problem+json" },
                ),
              ),
            ),
            Match.tag("DatabaseError", ({ cause }) =>
              Effect.succeed(
                c.json(
                  {
                    type: "/problems/service-unavailable",
                    title: "Service Unavailable",
                    status: 503,
                    detail: cause,
                    instance: c.req.path,
                  } as const,
                  503,
                  { "Content-Type": "application/problem+json" },
                ),
              ),
            ),
            Match.tag("FileReadError", ({ path, cause }) =>
              Effect.logError("cannot read the schema", path, cause).pipe(
                Effect.as(
                  c.json(
                    {
                      type: "/problems/internal-server-error",
                      title: "Internal Server Error",
                      status: 500,
                      detail: "An unexpected error occurred.",
                      instance: c.req.path,
                    } as const,
                    500,
                    { "Content-Type": "application/problem+json" },
                  ),
                ),
              ),
            ),
            Match.exhaustive,
          ),
      },
    ),
  );
};

/**
 * `POST /db/rows/{tableName}` handler. Inserts a row.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant C as Client
 *   participant H as Handler
 *   participant U as DbUseCase
 *   C->>H: POST /db/rows/{tableName} { values }
 *   H->>U: insertRow({ table, values })
 *   U-->>H: Affected
 *   H-->>C: 200 Affected
 *   Note over H: on failure, Match.tag: UnknownTableError -> 404, InvalidInputError -> 422, DatabaseUnavailableError -> 503, DatabaseError -> 503, FileReadError -> 500
 * ```
 */
export const postDbRowsTableNameRouteHandler: RouteHandler<typeof postDbRowsTableNameRoute> = (
  c,
) => {
  const data = { ...c.req.valid("param"), ...c.req.valid("json") };
  return Effect.runPromise(
    Effect.matchEffect(DbUseCase.insertRow({ table: data.tableName, values: data.values }), {
      onSuccess: (value) => Effect.succeed(c.json(AffectedSchema.parse(value), 200)),
      onFailure: (error) =>
        Match.value(error).pipe(
          Match.tag("UnknownTableError", ({ table }) =>
            Effect.succeed(
              c.json(
                {
                  type: "/problems/not-found",
                  title: "Not Found",
                  status: 404,
                  detail: `Unknown table "${table}".`,
                  instance: c.req.path,
                } as const,
                404,
                { "Content-Type": "application/problem+json" },
              ),
            ),
          ),
          Match.tag("InvalidInputError", ({ field, message }) =>
            Effect.succeed(
              c.json(
                {
                  type: "/problems/validation-failed",
                  title: "Validation Failed",
                  status: 422,
                  detail: message,
                  instance: c.req.path,
                  errors: [{ field, message }],
                } as const,
                422,
                { "Content-Type": "application/problem+json" },
              ),
            ),
          ),
          Match.tag("DatabaseUnavailableError", ({ reason }) =>
            Effect.succeed(
              c.json(
                {
                  type: "/problems/service-unavailable",
                  title: "Service Unavailable",
                  status: 503,
                  detail: reason,
                  instance: c.req.path,
                } as const,
                503,
                { "Content-Type": "application/problem+json" },
              ),
            ),
          ),
          Match.tag("DatabaseError", ({ cause }) =>
            Effect.succeed(
              c.json(
                {
                  type: "/problems/service-unavailable",
                  title: "Service Unavailable",
                  status: 503,
                  detail: cause,
                  instance: c.req.path,
                } as const,
                503,
                { "Content-Type": "application/problem+json" },
              ),
            ),
          ),
          Match.tag("FileReadError", ({ path, cause }) =>
            Effect.logError("cannot read the schema", path, cause).pipe(
              Effect.as(
                c.json(
                  {
                    type: "/problems/internal-server-error",
                    title: "Internal Server Error",
                    status: 500,
                    detail: "An unexpected error occurred.",
                    instance: c.req.path,
                  } as const,
                  500,
                  { "Content-Type": "application/problem+json" },
                ),
              ),
            ),
          ),
          Match.exhaustive,
        ),
    }),
  );
};

/**
 * `PATCH /db/rows/{tableName}` handler. Updates the row `where` names.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant C as Client
 *   participant H as Handler
 *   participant U as DbUseCase
 *   C->>H: PATCH /db/rows/{tableName} { where, values }
 *   H->>U: updateRow({ table, where, values })
 *   U-->>H: Affected
 *   H-->>C: 200 Affected
 *   Note over H: on failure, Match.tag: UnknownTableError -> 404, InvalidInputError -> 422, DatabaseUnavailableError -> 503, DatabaseError -> 503, FileReadError -> 500
 * ```
 */
export const patchDbRowsTableNameRouteHandler: RouteHandler<typeof patchDbRowsTableNameRoute> = (
  c,
) => {
  const data = { ...c.req.valid("param"), ...c.req.valid("json") };
  return Effect.runPromise(
    Effect.matchEffect(
      DbUseCase.updateRow({ table: data.tableName, where: data.where, values: data.values }),
      {
        onSuccess: (value) => Effect.succeed(c.json(AffectedSchema.parse(value), 200)),
        onFailure: (error) =>
          Match.value(error).pipe(
            Match.tag("UnknownTableError", ({ table }) =>
              Effect.succeed(
                c.json(
                  {
                    type: "/problems/not-found",
                    title: "Not Found",
                    status: 404,
                    detail: `Unknown table "${table}".`,
                    instance: c.req.path,
                  } as const,
                  404,
                  { "Content-Type": "application/problem+json" },
                ),
              ),
            ),
            Match.tag("InvalidInputError", ({ field, message }) =>
              Effect.succeed(
                c.json(
                  {
                    type: "/problems/validation-failed",
                    title: "Validation Failed",
                    status: 422,
                    detail: message,
                    instance: c.req.path,
                    errors: [{ field, message }],
                  } as const,
                  422,
                  { "Content-Type": "application/problem+json" },
                ),
              ),
            ),
            Match.tag("DatabaseUnavailableError", ({ reason }) =>
              Effect.succeed(
                c.json(
                  {
                    type: "/problems/service-unavailable",
                    title: "Service Unavailable",
                    status: 503,
                    detail: reason,
                    instance: c.req.path,
                  } as const,
                  503,
                  { "Content-Type": "application/problem+json" },
                ),
              ),
            ),
            Match.tag("DatabaseError", ({ cause }) =>
              Effect.succeed(
                c.json(
                  {
                    type: "/problems/service-unavailable",
                    title: "Service Unavailable",
                    status: 503,
                    detail: cause,
                    instance: c.req.path,
                  } as const,
                  503,
                  { "Content-Type": "application/problem+json" },
                ),
              ),
            ),
            Match.tag("FileReadError", ({ path, cause }) =>
              Effect.logError("cannot read the schema", path, cause).pipe(
                Effect.as(
                  c.json(
                    {
                      type: "/problems/internal-server-error",
                      title: "Internal Server Error",
                      status: 500,
                      detail: "An unexpected error occurred.",
                      instance: c.req.path,
                    } as const,
                    500,
                    { "Content-Type": "application/problem+json" },
                  ),
                ),
              ),
            ),
            Match.exhaustive,
          ),
      },
    ),
  );
};

/**
 * `DELETE /db/rows/{tableName}` handler. Deletes the row `where` names.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant C as Client
 *   participant H as Handler
 *   participant U as DbUseCase
 *   C->>H: DELETE /db/rows/{tableName} { where }
 *   H->>U: deleteRow({ table, where })
 *   U-->>H: Affected
 *   H-->>C: 200 Affected
 *   Note over H: on failure, Match.tag: UnknownTableError -> 404, InvalidInputError -> 422, DatabaseUnavailableError -> 503, DatabaseError -> 503, FileReadError -> 500
 * ```
 */
export const deleteDbRowsTableNameRouteHandler: RouteHandler<typeof deleteDbRowsTableNameRoute> = (
  c,
) => {
  const data = { ...c.req.valid("param"), ...c.req.valid("json") };
  return Effect.runPromise(
    Effect.matchEffect(DbUseCase.deleteRow({ table: data.tableName, where: data.where }), {
      onSuccess: (value) => Effect.succeed(c.json(AffectedSchema.parse(value), 200)),
      onFailure: (error) =>
        Match.value(error).pipe(
          Match.tag("UnknownTableError", ({ table }) =>
            Effect.succeed(
              c.json(
                {
                  type: "/problems/not-found",
                  title: "Not Found",
                  status: 404,
                  detail: `Unknown table "${table}".`,
                  instance: c.req.path,
                } as const,
                404,
                { "Content-Type": "application/problem+json" },
              ),
            ),
          ),
          Match.tag("InvalidInputError", ({ field, message }) =>
            Effect.succeed(
              c.json(
                {
                  type: "/problems/validation-failed",
                  title: "Validation Failed",
                  status: 422,
                  detail: message,
                  instance: c.req.path,
                  errors: [{ field, message }],
                } as const,
                422,
                { "Content-Type": "application/problem+json" },
              ),
            ),
          ),
          Match.tag("DatabaseUnavailableError", ({ reason }) =>
            Effect.succeed(
              c.json(
                {
                  type: "/problems/service-unavailable",
                  title: "Service Unavailable",
                  status: 503,
                  detail: reason,
                  instance: c.req.path,
                } as const,
                503,
                { "Content-Type": "application/problem+json" },
              ),
            ),
          ),
          Match.tag("DatabaseError", ({ cause }) =>
            Effect.succeed(
              c.json(
                {
                  type: "/problems/service-unavailable",
                  title: "Service Unavailable",
                  status: 503,
                  detail: cause,
                  instance: c.req.path,
                } as const,
                503,
                { "Content-Type": "application/problem+json" },
              ),
            ),
          ),
          Match.tag("FileReadError", ({ path, cause }) =>
            Effect.logError("cannot read the schema", path, cause).pipe(
              Effect.as(
                c.json(
                  {
                    type: "/problems/internal-server-error",
                    title: "Internal Server Error",
                    status: 500,
                    detail: "An unexpected error occurred.",
                    instance: c.req.path,
                  } as const,
                  500,
                  { "Content-Type": "application/problem+json" },
                ),
              ),
            ),
          ),
          Match.exhaustive,
        ),
    }),
  );
};

/**
 * `POST /db/sql` handler. Runs the statements one by one; the result is the last one's, and one
 * the database rejects is a 503 with its message.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant C as Client
 *   participant H as Handler
 *   participant U as DbUseCase
 *   C->>H: POST /db/sql { sql, params }
 *   H->>U: runSql({ sql, params })
 *   U-->>H: SqlResult
 *   H-->>C: 200 SqlResult
 *   Note over H: on failure, Match.tag: InvalidInputError -> 422, DatabaseUnavailableError -> 503, DatabaseError -> 503
 * ```
 */
export const postDbSqlRouteHandler: RouteHandler<typeof postDbSqlRoute> = (c) => {
  const data = c.req.valid("json");
  return Effect.runPromise(
    Effect.matchEffect(DbUseCase.runSql({ sql: data.sql, params: data.params ?? [] }), {
      onSuccess: (value) => Effect.succeed(c.json(SqlResultSchema.parse(value), 200)),
      onFailure: (error) =>
        Match.value(error).pipe(
          Match.tag("InvalidInputError", ({ field, message }) =>
            Effect.succeed(
              c.json(
                {
                  type: "/problems/validation-failed",
                  title: "Validation Failed",
                  status: 422,
                  detail: message,
                  instance: c.req.path,
                  errors: [{ field, message }],
                } as const,
                422,
                { "Content-Type": "application/problem+json" },
              ),
            ),
          ),
          Match.tag("DatabaseUnavailableError", ({ reason }) =>
            Effect.succeed(
              c.json(
                {
                  type: "/problems/service-unavailable",
                  title: "Service Unavailable",
                  status: 503,
                  detail: reason,
                  instance: c.req.path,
                } as const,
                503,
                { "Content-Type": "application/problem+json" },
              ),
            ),
          ),
          Match.tag("DatabaseError", ({ cause }) =>
            Effect.succeed(
              c.json(
                {
                  type: "/problems/service-unavailable",
                  title: "Service Unavailable",
                  status: 503,
                  detail: cause,
                  instance: c.req.path,
                } as const,
                503,
                { "Content-Type": "application/problem+json" },
              ),
            ),
          ),
          Match.exhaustive,
        ),
    }),
  );
};

/**
 * `POST /db/explain` handler. The plan the database chooses for the first statement.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant C as Client
 *   participant H as Handler
 *   participant U as DbUseCase
 *   C->>H: POST /db/explain { sql, params }
 *   H->>U: explainSql({ sql, params })
 *   U-->>H: Plan
 *   H-->>C: 200 Plan
 *   Note over H: on failure, Match.tag: InvalidInputError -> 422, DatabaseUnavailableError -> 503, DatabaseError -> 503
 * ```
 */
export const postDbExplainRouteHandler: RouteHandler<typeof postDbExplainRoute> = (c) => {
  const data = c.req.valid("json");
  return Effect.runPromise(
    Effect.matchEffect(DbUseCase.explainSql({ sql: data.sql, params: data.params ?? [] }), {
      onSuccess: (value) => Effect.succeed(c.json(PlanSchema.parse(value), 200)),
      onFailure: (error) =>
        Match.value(error).pipe(
          Match.tag("InvalidInputError", ({ field, message }) =>
            Effect.succeed(
              c.json(
                {
                  type: "/problems/validation-failed",
                  title: "Validation Failed",
                  status: 422,
                  detail: message,
                  instance: c.req.path,
                  errors: [{ field, message }],
                } as const,
                422,
                { "Content-Type": "application/problem+json" },
              ),
            ),
          ),
          Match.tag("DatabaseUnavailableError", ({ reason }) =>
            Effect.succeed(
              c.json(
                {
                  type: "/problems/service-unavailable",
                  title: "Service Unavailable",
                  status: 503,
                  detail: reason,
                  instance: c.req.path,
                } as const,
                503,
                { "Content-Type": "application/problem+json" },
              ),
            ),
          ),
          Match.tag("DatabaseError", ({ cause }) =>
            Effect.succeed(
              c.json(
                {
                  type: "/problems/service-unavailable",
                  title: "Service Unavailable",
                  status: 503,
                  detail: cause,
                  instance: c.req.path,
                } as const,
                503,
                { "Content-Type": "application/problem+json" },
              ),
            ),
          ),
          Match.exhaustive,
        ),
    }),
  );
};

/**
 * `POST /db/analyze` handler. The statements read against the saved schema's tables.
 *
 * ```mermaid
 * sequenceDiagram
 *   participant C as Client
 *   participant H as Handler
 *   participant U as DbUseCase
 *   C->>H: POST /db/analyze { sql }
 *   H->>U: analyzeSql({ sql })
 *   U-->>H: Analysis
 *   H-->>C: 200 Analysis
 *   Note over H: on failure, Match.tag: FileReadError -> 500
 * ```
 */
export const postDbAnalyzeRouteHandler: RouteHandler<typeof postDbAnalyzeRoute> = (c) => {
  const data = c.req.valid("json");
  return Effect.runPromise(
    Effect.matchEffect(DbUseCase.analyzeSql({ sql: data.sql }), {
      onSuccess: (value) => Effect.succeed(c.json(AnalysisSchema.parse(value), 200)),
      onFailure: (error) =>
        Match.value(error).pipe(
          Match.tag("FileReadError", ({ path, cause }) =>
            Effect.logError("cannot read the schema", path, cause).pipe(
              Effect.as(
                c.json(
                  {
                    type: "/problems/internal-server-error",
                    title: "Internal Server Error",
                    status: 500,
                    detail: "An unexpected error occurred.",
                    instance: c.req.path,
                  } as const,
                  500,
                  { "Content-Type": "application/problem+json" },
                ),
              ),
            ),
          ),
          Match.exhaustive,
        ),
    }),
  );
};
