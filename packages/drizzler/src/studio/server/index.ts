import { OpenAPIHono } from "@hono/zod-openapi";
import { Effect } from "effect";
import {
  deleteDbRowsTableNameRoute,
  getDbCountsRoute,
  getDbRoute,
  getDbRowsTableNameRoute,
  getDocsRoute,
  getLanguageRoute,
  getSchemaEventsRoute,
  getSchemaRoute,
  patchDbRowsTableNameRoute,
  postDbAnalyzeRoute,
  postDbExplainRoute,
  postDbRowsTableNameRoute,
  postDbSqlRoute,
  postDiagramPngRoute,
  postDiagramSchemaRoute,
  postDiagramSvgRoute,
  postDrizzleRoute,
  postDrizzleTouchedRoute,
  postFormatRoute,
  postLanguageCompleteDetailRoute,
  postLanguageCompleteRoute,
  postLanguageDiagnosticsRoute,
  postLanguageHoverRoute,
  postLanguageSignatureRoute,
  putSchemaRoute,
} from "./routes";
import {
  deleteDbRowsTableNameRouteHandler,
  getDbCountsRouteHandler,
  getDbRouteHandler,
  getDbRowsTableNameRouteHandler,
  getDocsRouteHandler,
  getLanguageRouteHandler,
  getSchemaEventsRouteHandler,
  getSchemaRouteHandler,
  patchDbRowsTableNameRouteHandler,
  postDbAnalyzeRouteHandler,
  postDbExplainRouteHandler,
  postDbRowsTableNameRouteHandler,
  postDbSqlRouteHandler,
  postDiagramPngRouteHandler,
  postDiagramSchemaRouteHandler,
  postDiagramSvgRouteHandler,
  postDrizzleRouteHandler,
  postDrizzleTouchedRouteHandler,
  postFormatRouteHandler,
  postLanguageCompleteDetailRouteHandler,
  postLanguageCompleteRouteHandler,
  postLanguageDiagnosticsRouteHandler,
  postLanguageHoverRouteHandler,
  postLanguageSignatureRouteHandler,
  putSchemaRouteHandler,
} from "./handlers";

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

// main.tsp promises a 422 problem for a request that fails validation, where @hono/zod-openapi
// would answer 400 with the zod error.
const app = new OpenAPIHono({
  defaultHook(result, c) {
    if (!result.success) {
      return c.json(
        {
          type: "/problems/validation-failed",
          title: "Validation Failed",
          status: 422,
          detail: "The request failed validation. See `errors` for the offending fields.",
          instance: c.req.path,
          errors: result.error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
        422,
        { "Content-Type": "application/problem+json" },
      );
    }
  },
}).basePath("/api");

// The API is unauthenticated, so a page on another origin must not reach it even when its DNS name
// resolves to this machine. Registered before the routes, so it runs first (`*` is `/api/*` here).
app.use("*", (c, next) =>
  LOOPBACK.has(new URL(c.req.url).hostname)
    ? next()
    : Promise.resolve(c.text("drizzler studio answers only on localhost.", 403)),
);

app.onError((error, c) => {
  Effect.runSync(Effect.logError("unhandled error", error));
  return c.json(
    {
      type: "/problems/internal-server-error",
      title: "Internal Server Error",
      status: 500,
      detail: "An unexpected error occurred.",
      instance: c.req.path,
    } as const,
    500,
    { "Content-Type": "application/problem+json" },
  );
});

export const schema = app
  .openapi(getSchemaRoute, getSchemaRouteHandler)
  .openapi(putSchemaRoute, putSchemaRouteHandler)
  .openapi(getSchemaEventsRoute, getSchemaEventsRouteHandler);

export const diagram = app
  .openapi(postDiagramSchemaRoute, postDiagramSchemaRouteHandler)
  .openapi(postDiagramSvgRoute, postDiagramSvgRouteHandler)
  .openapi(postDiagramPngRoute, postDiagramPngRouteHandler);

export const format = app.openapi(postFormatRoute, postFormatRouteHandler);

export const docs = app.openapi(getDocsRoute, getDocsRouteHandler);

export const db = app
  .openapi(getDbRoute, getDbRouteHandler)
  .openapi(getDbCountsRoute, getDbCountsRouteHandler)
  .openapi(getDbRowsTableNameRoute, getDbRowsTableNameRouteHandler)
  .openapi(postDbRowsTableNameRoute, postDbRowsTableNameRouteHandler)
  .openapi(patchDbRowsTableNameRoute, patchDbRowsTableNameRouteHandler)
  .openapi(deleteDbRowsTableNameRoute, deleteDbRowsTableNameRouteHandler)
  .openapi(postDbSqlRoute, postDbSqlRouteHandler)
  .openapi(postDbExplainRoute, postDbExplainRouteHandler)
  .openapi(postDbAnalyzeRoute, postDbAnalyzeRouteHandler);

export const language = app
  .openapi(getLanguageRoute, getLanguageRouteHandler)
  .openapi(postLanguageCompleteRoute, postLanguageCompleteRouteHandler)
  .openapi(postLanguageCompleteDetailRoute, postLanguageCompleteDetailRouteHandler)
  .openapi(postLanguageHoverRoute, postLanguageHoverRouteHandler)
  .openapi(postLanguageSignatureRoute, postLanguageSignatureRouteHandler)
  .openapi(postLanguageDiagnosticsRoute, postLanguageDiagnosticsRouteHandler);

export const drizzle = app
  .openapi(postDrizzleRoute, postDrizzleRouteHandler)
  .openapi(postDrizzleTouchedRoute, postDrizzleTouchedRouteHandler);

export default app;
