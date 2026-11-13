import { hc } from "hono/client";
import type { schema, diagram, format, docs, db, language, drizzle } from "../../server/index";

type SchemaClient = ReturnType<typeof hc<typeof schema>>;

function hcSchemaWithType(...args: Parameters<typeof hc>): SchemaClient {
  return hc<typeof schema>(...args);
}

export const schemaClient = hcSchemaWithType("/").api;

type DiagramClient = ReturnType<typeof hc<typeof diagram>>;

function hcDiagramWithType(...args: Parameters<typeof hc>): DiagramClient {
  return hc<typeof diagram>(...args);
}

export const diagramClient = hcDiagramWithType("/").api;

type FormatClient = ReturnType<typeof hc<typeof format>>;

function hcFormatWithType(...args: Parameters<typeof hc>): FormatClient {
  return hc<typeof format>(...args);
}

export const formatClient = hcFormatWithType("/").api;

type DocsClient = ReturnType<typeof hc<typeof docs>>;

function hcDocsWithType(...args: Parameters<typeof hc>): DocsClient {
  return hc<typeof docs>(...args);
}

export const docsClient = hcDocsWithType("/").api;

type DbClient = ReturnType<typeof hc<typeof db>>;

function hcDbWithType(...args: Parameters<typeof hc>): DbClient {
  return hc<typeof db>(...args);
}

export const dbClient = hcDbWithType("/").api;

type LanguageClient = ReturnType<typeof hc<typeof language>>;

function hcLanguageWithType(...args: Parameters<typeof hc>): LanguageClient {
  return hc<typeof language>(...args);
}

export const languageClient = hcLanguageWithType("/").api;

type DrizzleClient = ReturnType<typeof hc<typeof drizzle>>;

function hcDrizzleWithType(...args: Parameters<typeof hc>): DrizzleClient {
  return hc<typeof drizzle>(...args);
}

export const drizzleClient = hcDrizzleWithType("/").api;
