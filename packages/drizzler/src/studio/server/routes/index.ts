import { createRoute, z } from "@hono/zod-openapi";

export const ParseErrorSchema = z
  .object({
    message: z.string().openapi({ description: "What the parser expected" }),
    line: z.int32().openapi({ description: "The line of the error" }),
    column: z.int32().openapi({ description: "The column of the error" }),
  })
  .readonly()
  .openapi({
    required: ["message", "line", "column"],
    description: "Where a syntax error stopped the parser, 1-based.",
    example: { message: "Expected `)` but found `EOF`", line: 12, column: 3 },
  })
  .openapi("ParseError");

export const SnapshotSchema = z
  .object({
    path: z.string().openapi({ description: "The path the studio was started with" }),
    file: z.string().openapi({ description: "The file name, for the title" }),
    source: z.string().openapi({ description: "The file's text" }),
    parseError: ParseErrorSchema.nullable().openapi({
      description: "The first syntax error in the file, or null when it parses",
    }),
  })
  .readonly()
  .openapi({
    required: ["path", "file", "source", "parseError"],
    description: "The schema file as it is on disk.",
  })
  .openapi("Snapshot");

export const InternalServerProblemSchema = z
  .object({
    type: z
      .literal("/problems/internal-server-error")
      .openapi({ description: "Problem type identifier (relative URI reference)" }),
    title: z
      .literal("Internal Server Error")
      .openapi({ description: "Short, human-readable summary of the problem type" }),
    status: z
      .literal(500)
      .openapi({ description: "HTTP status code, restated in the body per RFC 9457" }),
    detail: z
      .string()
      .openapi({ description: "Human-readable explanation specific to this occurrence" }),
    instance: z
      .string()
      .openapi({ description: "URI reference identifying this occurrence (the request path)" }),
  })
  .readonly()
  .openapi({
    required: ["type", "title", "status", "detail", "instance"],
    description: "RFC 9457 Problem Details for any unexpected failure.",
  })
  .openapi("InternalServerProblem");

export const FieldErrorSchema = z
  .object({
    field: z.string().openapi({ description: "The dotted path of the field" }),
    message: z.string().openapi({ description: "Why it failed" }),
  })
  .readonly()
  .openapi({ required: ["field", "message"], description: "One field that failed validation." })
  .openapi("FieldError");

export const ValidationProblemSchema = z
  .object({
    type: z
      .literal("/problems/validation-failed")
      .openapi({ description: "Problem type identifier (relative URI reference)" }),
    title: z
      .literal("Validation Failed")
      .openapi({ description: "Short, human-readable summary of the problem type" }),
    status: z
      .literal(422)
      .openapi({ description: "HTTP status code, restated in the body per RFC 9457" }),
    detail: z
      .string()
      .openapi({ description: "Human-readable explanation specific to this occurrence" }),
    instance: z
      .string()
      .openapi({ description: "URI reference identifying this occurrence (the request path)" }),
    errors: z
      .array(FieldErrorSchema)
      .readonly()
      .openapi({ description: "Extension member: one entry per field that failed validation" }),
  })
  .readonly()
  .openapi({
    required: ["type", "title", "status", "detail", "instance", "errors"],
    description: "RFC 9457 Problem Details for a request that failed validation.",
  })
  .openapi("ValidationProblem");

export const SaveBodySchema = z
  .object({ source: z.string().openapi({ description: "The whole file" }) })
  .readonly()
  .openapi({ required: ["source"], description: "Text to write to the schema file." })
  .openapi("SaveBody");

export const CanvasFieldSchema = z
  .object({
    name: z.string().openapi({ description: "The property name" }),
    dbName: z
      .string()
      .nullable()
      .openapi({ description: "The database column name when it differs" }),
    kind: z.enum(["scalar", "enum"]).openapi({ description: "Whether it holds an enum" }),
    type: z.string().openapi({ description: "The column builder, or the enum's name" }),
    isList: z.boolean().openapi({ description: "Whether it is an array column" }),
    isRequired: z.boolean().openapi({ description: "Whether it is NOT NULL" }),
    isId: z.boolean().openapi({ description: "Whether it is the primary key" }),
    isUnique: z.boolean().openapi({ description: "Whether a unique constraint covers it alone" }),
    isForeignKey: z.boolean().openapi({ description: "Whether it references another table" }),
    documentation: z.string().nullable().openapi({ description: "The `///` description" }),
    attributes: z
      .array(z.string())
      .readonly()
      .openapi({ description: "Its defaults and generated values, as written" }),
  })
  .readonly()
  .openapi({
    required: [
      "name",
      "dbName",
      "kind",
      "type",
      "isList",
      "isRequired",
      "isId",
      "isUnique",
      "isForeignKey",
      "documentation",
      "attributes",
    ],
    description: "A column as a row of a card.",
  })
  .openapi("CanvasField");

export const CanvasIndexSchema = z
  .object({
    type: z
      .enum(["id", "unique", "normal", "fulltext"])
      .openapi({ description: "What kind it is" }),
    fields: z.array(z.string()).readonly().openapi({ description: "The columns it covers" }),
  })
  .readonly()
  .openapi({
    required: ["type", "fields"],
    description: "An index or constraint as the card lists it under its rows.",
  })
  .openapi("CanvasIndex");

export const LineRangeSchema = z
  .object({
    start: z.int32().openapi({ description: "The first line" }),
    end: z.int32().openapi({ description: "The last line" }),
  })
  .readonly()
  .openapi({
    required: ["start", "end"],
    description: "Lines of the source, 1-based and inclusive.",
  })
  .openapi("LineRange");

export const CanvasModelSchema = z
  .object({
    name: z.string().openapi({ description: "The exported name" }),
    dbName: z
      .string()
      .nullable()
      .openapi({ description: "The database table name when it differs" }),
    documentation: z.string().nullable().openapi({ description: "The `///` description" }),
    primaryKey: z
      .array(z.string())
      .readonly()
      .nullable()
      .openapi({ description: "The columns of a composite primary key" }),
    fields: z.array(CanvasFieldSchema).readonly().openapi({ description: "A row per column" }),
    indexes: z
      .array(CanvasIndexSchema)
      .readonly()
      .openapi({ description: "Its indexes and constraints" }),
    lines: LineRangeSchema.openapi({
      description: "Where the table is declared, for the editor to point at",
    }),
  })
  .readonly()
  .openapi({
    required: ["name", "dbName", "documentation", "primaryKey", "fields", "indexes", "lines"],
    description: "A table as a card.",
  })
  .openapi("CanvasModel");

export const RelationEndSchema = z
  .object({
    model: z.string().openapi({ description: "The table" }),
    field: z.string().openapi({ description: "The column" }),
    cardinality: z
      .enum(["one", "zero-one", "many", "zero-many"])
      .openapi({ description: "How many rows this end has" }),
  })
  .readonly()
  .openapi({ required: ["model", "field", "cardinality"], description: "One end of a relation." })
  .openapi("RelationEnd");

export const CanvasRelationSchema = z
  .object({
    id: z.string().openapi({ description: "A key for the edge: `from.field->to.field`" }),
    origin: z.enum(["inferred", "relations", "implicit-many-to-many"]).openapi({
      description:
        "Where it was found: a foreign key (`inferred`) or only `defineRelations` (`relations`)",
    }),
    name: z.string().nullable().openapi({ description: "Its name, when it has one" }),
    onDelete: z
      .string()
      .nullable()
      .openapi({ description: "The action on delete of the parent row" }),
    onUpdate: z
      .string()
      .nullable()
      .openapi({ description: "The action on update of the parent key" }),
    from: RelationEndSchema.openapi({ description: "The referenced end" }),
    to: RelationEndSchema.openapi({ description: "The end that holds the foreign key" }),
  })
  .readonly()
  .openapi({
    required: ["id", "origin", "name", "onDelete", "onUpdate", "from", "to"],
    description: "A relation as an edge.",
  })
  .openapi("CanvasRelation");

export const CanvasEnumValueSchema = z
  .object({
    name: z.string().openapi({ description: "The value" }),
    dbName: z.string().nullable().openapi({ description: "The stored value when it differs" }),
  })
  .readonly()
  .openapi({ required: ["name", "dbName"], description: "One value of an enum." })
  .openapi("CanvasEnumValue");

export const CanvasEnumSchema = z
  .object({
    name: z.string().openapi({ description: "The exported name" }),
    dbName: z
      .string()
      .nullable()
      .openapi({ description: "The database type name when it differs" }),
    documentation: z.string().nullable().openapi({ description: "The `///` description" }),
    values: z
      .array(CanvasEnumValueSchema)
      .readonly()
      .openapi({ description: "Its values, in order" }),
  })
  .readonly()
  .openapi({
    required: ["name", "dbName", "documentation", "values"],
    description: "An enum as a card.",
  })
  .openapi("CanvasEnum");

export const CanvasSchemaSchema = z
  .object({
    models: z.array(CanvasModelSchema).readonly().openapi({ description: "A card per table" }),
    relations: z
      .array(CanvasRelationSchema)
      .readonly()
      .openapi({ description: "An edge per relation" }),
    enums: z.array(CanvasEnumSchema).readonly().openapi({ description: "A card per enum" }),
  })
  .readonly()
  .openapi({
    required: ["models", "relations", "enums"],
    description: "A schema as the diagram canvas draws it.",
  })
  .openapi("CanvasSchema");

export const DiagramDataSchema = z
  .object({
    schema: CanvasSchemaSchema.nullable().openapi({
      description: "The tables, relations and enums; null when the source does not parse",
    }),
    parseError: ParseErrorSchema.nullable().openapi({
      description: "The syntax error that stopped it",
    }),
  })
  .readonly()
  .openapi({
    required: ["schema", "parseError"],
    description: "The ER diagram as data, for the page to draw and lay out itself.",
  })
  .openapi("DiagramData");

export const DocumentKindSchema = z
  .enum(["schema", "query"])
  .openapi({ description: "Which editor a language request is about." })
  .openapi("DocumentKind");

export const SourceBodySchema = z
  .object({
    source: z.string().openapi({ description: "The schema source, saved or not, or the query" }),
    document: DocumentKindSchema.exactOptional().openapi({
      description: "Which editor it comes from; the schema when left out",
    }),
  })
  .readonly()
  .openapi({ required: ["source"], description: "A source to check." })
  .openapi("SourceBody");

export const DiagramSchema = z
  .object({
    svg: z
      .string()
      .nullable()
      .openapi({ description: "The SVG document, null when the source does not parse" }),
    parseError: ParseErrorSchema.nullable().openapi({
      description: "The syntax error that stopped the drawing",
    }),
  })
  .readonly()
  .openapi({
    required: ["svg", "parseError"],
    description: "The ER diagram of a schema, or why it could not be drawn.",
  })
  .openapi("Diagram");

export const ThemeSchema = z
  .enum(["light", "dark"])
  .openapi({ description: "The colour scheme a diagram is drawn in." })
  .openapi("Theme");

export const DiagramBodySchema = z
  .object({
    source: z.string().openapi({ description: "The schema source" }),
    theme: ThemeSchema.exactOptional().openapi({
      description: "The colour scheme; light when left out",
    }),
  })
  .readonly()
  .openapi({
    required: ["source"],
    description: "A schema to draw: the editor buffer, saved or not.",
  })
  .openapi("DiagramBody");

export const PngSchema = z
  .object({ base64: z.string().openapi({ description: "The PNG file, base64-encoded" }) })
  .readonly()
  .openapi({ required: ["base64"], description: "The ER diagram rasterised to PNG at 2x." })
  .openapi("Png");

export const FormattedSchema = z
  .object({ source: z.string().openapi({ description: "The source as the formatter prints it" }) })
  .readonly()
  .openapi({ required: ["source"], description: "The formatted text." })
  .openapi("Formatted");

export const FormatBodySchema = z
  .object({ source: z.string().openapi({ description: "The schema source" }) })
  .readonly()
  .openapi({
    required: ["source"],
    description:
      "Text to format, with the project's `.oxfmtrc.json` when it has one and oxfmt's defaults when not.",
  })
  .openapi("FormatBody");

export const ColumnReferenceSchema = z
  .object({
    table: z.string().openapi({ description: "The table it references" }),
    column: z.string().openapi({ description: "The column it references" }),
  })
  .readonly()
  .openapi({
    required: ["table", "column"],
    description: "What a column points at through a foreign key or a relation.",
  })
  .openapi("ColumnReference");

export const DocColumnSchema = z
  .object({
    name: z.string().openapi({ description: "The property name in the schema" }),
    dbName: z.string().openapi({ description: "The database column name" }),
    type: z
      .string()
      .openapi({ description: "The column builder (`varchar`, `uuid`, an enum's name, ...)" }),
    nullable: z.boolean().openapi({ description: "Whether the column may hold null" }),
    primaryKey: z.boolean().openapi({ description: "Whether it is the primary key or part of it" }),
    unique: z.boolean().openapi({ description: "Whether a unique constraint covers it alone" }),
    isList: z.boolean().openapi({ description: "Whether it is an array column" }),
    enumName: z
      .string()
      .nullable()
      .openapi({ description: "The enum it holds, null for a scalar" }),
    defaults: z
      .array(z.string())
      .readonly()
      .openapi({ description: "Its default and generated values, as written" }),
    description: z.string().nullable().openapi({ description: "The `///` description" }),
    references: ColumnReferenceSchema.nullable().openapi({
      description: "The column it references, null when it is not a foreign key",
    }),
  })
  .readonly()
  .openapi({
    required: [
      "name",
      "dbName",
      "type",
      "nullable",
      "primaryKey",
      "unique",
      "isList",
      "enumName",
      "defaults",
      "description",
      "references",
    ],
    description: "A column as the docs describe it.",
  })
  .openapi("DocColumn");

export const DocIndexSchema = z
  .object({
    type: z
      .enum(["id", "unique", "normal", "fulltext"])
      .openapi({ description: "What kind it is" }),
    columns: z.array(z.string()).readonly().openapi({ description: "The columns it covers" }),
  })
  .readonly()
  .openapi({
    required: ["type", "columns"],
    description: "An index or constraint over one or more columns.",
  })
  .openapi("DocIndex");

export const DocRelationSchema = z
  .object({
    table: z.string().openapi({ description: "The other table" }),
    column: z.string().openapi({ description: "The column on this side" }),
    otherColumn: z.string().openapi({ description: "The column on the other side" }),
    kind: z
      .string()
      .openapi({ description: "How it reads from this side: `one to many`, `many to one`, ..." }),
    origin: z.string().openapi({
      description:
        "Where it was found: a foreign key (`inferred`) or only `defineRelations` (`relations`)",
    }),
    onDelete: z
      .string()
      .nullable()
      .openapi({ description: "The action on delete of the parent row" }),
    onUpdate: z
      .string()
      .nullable()
      .openapi({ description: "The action on update of the parent key" }),
  })
  .readonly()
  .openapi({
    required: ["table", "column", "otherColumn", "kind", "origin", "onDelete", "onUpdate"],
    description: "A relation as seen from one table.",
  })
  .openapi("DocRelation");

export const DocQuerySchema = z
  .object({
    name: z.string().openapi({
      description: "What it does, as a title: `Select`, `Count`, `Find many`, `With relations`",
    }),
    description: z.string().openapi({ description: "A sentence about it" }),
    code: z.string().openapi({ description: "The code, as the Query page runs it" }),
  })
  .readonly()
  .openapi({
    required: ["name", "description", "code"],
    description: "A Drizzle query to try against a table, for the docs.",
  })
  .openapi("DocQuery");

export const DocTableSchema = z
  .object({
    name: z.string().openapi({ description: "The exported name" }),
    dbName: z.string().openapi({ description: "The database table name" }),
    description: z.string().nullable().openapi({ description: "The `///` description above it" }),
    columns: z
      .array(DocColumnSchema)
      .readonly()
      .openapi({ description: "Its columns, in declaration order" }),
    indexes: z
      .array(DocIndexSchema)
      .readonly()
      .openapi({ description: "Its indexes and constraints" }),
    references: z
      .array(DocRelationSchema)
      .readonly()
      .openapi({ description: "The relations where this table holds the foreign key" }),
    referencedBy: z
      .array(DocRelationSchema)
      .readonly()
      .openapi({ description: "The relations where another table points here" }),
    queries: z
      .array(DocQuerySchema)
      .readonly()
      .openapi({ description: "Drizzle queries to start from" }),
  })
  .readonly()
  .openapi({
    required: [
      "name",
      "dbName",
      "description",
      "columns",
      "indexes",
      "references",
      "referencedBy",
      "queries",
    ],
    description: "One table of the docs.",
  })
  .openapi("DocTable");

export const DocEnumSchema = z
  .object({
    name: z.string().openapi({ description: "The exported name" }),
    dbName: z.string().openapi({ description: "The database type name" }),
    description: z.string().nullable().openapi({ description: "The `///` description above it" }),
    values: z.array(z.string()).readonly().openapi({ description: "Its values, in order" }),
  })
  .readonly()
  .openapi({
    required: ["name", "dbName", "description", "values"],
    description: "One enum of the docs.",
  })
  .openapi("DocEnum");

export const DocsSchema = z
  .object({
    tables: z
      .array(DocTableSchema)
      .readonly()
      .openapi({ description: "Every table, in file order" }),
    enums: z.array(DocEnumSchema).readonly().openapi({ description: "Every enum, in file order" }),
    parseError: ParseErrorSchema.nullable().openapi({
      description: "The syntax error that kept the docs from being read",
    }),
  })
  .readonly()
  .openapi({
    required: ["tables", "enums", "parseError"],
    description: "The generated documentation of the saved schema.",
  })
  .openapi("Docs");

export const DbColumnSchema = z
  .object({
    name: z.string().openapi({ description: "The property name in the schema" }),
    column: z.string().openapi({ description: "The database column name" }),
    type: z.string().openapi({ description: "The column builder" }),
    nullable: z.boolean().openapi({ description: "Whether it may hold null" }),
  })
  .readonly()
  .openapi({
    required: ["name", "column", "type", "nullable"],
    description: "A column the data views read and write.",
  })
  .openapi("DbColumn");

export const DbTableSchema = z
  .object({
    name: z.string().openapi({ description: "The exported name" }),
    table: z.string().openapi({ description: "The database table name" }),
    columns: z
      .array(DbColumnSchema)
      .readonly()
      .openapi({ description: "Its columns, in declaration order" }),
    key: z.array(z.string()).readonly().openapi({
      description:
        "The columns that identify a row: the primary key, else the unique columns, else all",
    }),
  })
  .readonly()
  .openapi({
    required: ["name", "table", "columns", "key"],
    description: "A table of the schema as the data views see it.",
  })
  .openapi("DbTable");

export const DbStatusSchema = z
  .object({
    connected: z.boolean().openapi({ description: "Whether a database is connected" }),
    dialect: z
      .enum(["sqlite", "postgresql", "mysql"])
      .nullable()
      .openapi({ description: "The SQL dialect of the connection" }),
    url: z
      .string()
      .nullable()
      .openapi({ description: "The connection URL with its password hidden" }),
    error: z
      .string()
      .nullable()
      .openapi({ description: "Why the connection failed, null when it did not" }),
    tables: z
      .array(DbTableSchema)
      .readonly()
      .openapi({ description: "The tables of the saved schema" }),
  })
  .readonly()
  .openapi({
    required: ["connected", "dialect", "url", "error", "tables"],
    description: "The database connection, and the tables the schema declares.",
  })
  .openapi("DbStatus");

export const CountsSchema = z
  .object({
    counts: z.record(z.string(), z.int32()).readonly().openapi({ description: "Rows per table" }),
  })
  .readonly()
  .openapi({
    required: ["counts"],
    description: "Row counts by table name; a table whose count fails is left out.",
  })
  .openapi("Counts");

export const ServiceUnavailableProblemSchema = z
  .object({
    type: z
      .literal("/problems/service-unavailable")
      .openapi({ description: "Problem type identifier (relative URI reference)" }),
    title: z
      .literal("Service Unavailable")
      .openapi({ description: "Short, human-readable summary of the problem type" }),
    status: z
      .literal(503)
      .openapi({ description: "HTTP status code, restated in the body per RFC 9457" }),
    detail: z
      .string()
      .openapi({ description: "Human-readable explanation specific to this occurrence" }),
    instance: z
      .string()
      .openapi({ description: "URI reference identifying this occurrence (the request path)" }),
  })
  .readonly()
  .openapi({
    required: ["type", "title", "status", "detail", "instance"],
    description:
      "RFC 9457 Problem Details for a request that needs the database while none is connected,\nor whose statement the database rejected.",
    example: {
      type: "/problems/service-unavailable",
      title: "Service Unavailable",
      status: 503,
      detail: "No database is connected. Pass --url to drizzler studio or set DATABASE_URL.",
      instance: "/api/db/counts",
    },
  })
  .openapi("ServiceUnavailableProblem");

export const TableNameSchema = z
  .string({ error: "Table name must be a JavaScript identifier" })
  .regex(/^[A-Za-z_$][A-Za-z0-9_$]*$/, { error: "Table name must be a JavaScript identifier" })
  .openapi({
    description: "A table as the schema exports it (`export const user = pgTable(...)` → `user`).",
  })
  .openapi("TableName");

export const SkipSchema = z.coerce
  .number()
  .pipe(z.int32().min(0))
  .prefault(0)
  .openapi({
    description: "Rows to skip before the page (0-based). Defaults to 0.",
    "x-minValue-message": "skip must be 0 or more",
  })
  .openapi("Skip");

export const TakeSchema = z.coerce
  .number()
  .pipe(z.int32().min(1).max(1000))
  .prefault(100)
  .openapi({
    description: "Rows per page (1-1000). Defaults to 100.",
    "x-maxValue-message": "take must be 1000 or fewer",
    "x-minValue-message": "take must be at least 1",
  })
  .openapi("Take");

export const RowSchema = z
  .record(z.string(), z.union([z.string(), z.float64(), z.boolean()]).nullable())
  .readonly()
  .openapi({ description: "A row keyed by column property name." })
  .openapi("Row");

export const RowsSchema = z
  .object({
    rows: z.array(RowSchema).readonly().openapi({ description: "The rows of the page" }),
    total: z.int32().openapi({ description: "How many rows the table has" }),
    skip: z.int32().openapi({ description: "The skip the page was read with" }),
    take: z.int32().openapi({ description: "The take the page was read with" }),
    search: z.string().openapi({
      description: "The search the page was read with; `total` counts the rows it matched",
    }),
  })
  .readonly()
  .openapi({
    required: ["rows", "total", "skip", "take", "search"],
    description: "One page of a table's rows.",
  })
  .openapi("Rows");

export const NotFoundProblemSchema = z
  .object({
    type: z
      .literal("/problems/not-found")
      .openapi({ description: "Problem type identifier (relative URI reference)" }),
    title: z
      .literal("Not Found")
      .openapi({ description: "Short, human-readable summary of the problem type" }),
    status: z
      .literal(404)
      .openapi({ description: "HTTP status code, restated in the body per RFC 9457" }),
    detail: z
      .string()
      .openapi({ description: "Human-readable explanation specific to this occurrence" }),
    instance: z
      .string()
      .openapi({ description: "URI reference identifying this occurrence (the request path)" }),
  })
  .readonly()
  .openapi({
    required: ["type", "title", "status", "detail", "instance"],
    description: "RFC 9457 Problem Details for a table the schema does not declare.",
    example: {
      type: "/problems/not-found",
      title: "Not Found",
      status: 404,
      detail: 'Unknown table "nope".',
      instance: "/api/db/rows/nope",
    },
  })
  .openapi("NotFoundProblem");

export const AffectedSchema = z
  .object({ count: z.int32().openapi({ description: "Rows changed" }) })
  .readonly()
  .openapi({ required: ["count"], description: "How many rows a write changed." })
  .openapi("Affected");

export const InsertBodySchema = z
  .object({
    values: RowSchema.openapi({ description: "The values to insert, keyed by property name" }),
  })
  .readonly()
  .openapi({ required: ["values"], description: "A row to insert." })
  .openapi("InsertBody");

export const UpdateBodySchema = z
  .object({
    where: RowSchema.openapi({ description: "The key columns of the row to change" }),
    values: RowSchema.openapi({ description: "The columns to set" }),
  })
  .readonly()
  .openapi({ required: ["where", "values"], description: "A row to change." })
  .openapi("UpdateBody");

export const DeleteBodySchema = z
  .object({ where: RowSchema.openapi({ description: "The key columns of the row to delete" }) })
  .readonly()
  .openapi({ required: ["where"], description: "A row to delete." })
  .openapi("DeleteBody");

export const SqlResultSchema = z
  .object({
    columns: z
      .array(z.string())
      .readonly()
      .openapi({ description: "The result columns, in order" }),
    rows: z.array(RowSchema).readonly().openapi({ description: "The rows, keyed by column" }),
    rowCount: z.int32().openapi({ description: "Rows returned, or changed by a write" }),
    durationMs: z.float64().openapi({ description: "How long the statement took" }),
  })
  .readonly()
  .openapi({
    required: ["columns", "rows", "rowCount", "durationMs"],
    description: "What a statement returned.",
  })
  .openapi("SqlResult");

export const SqlBodySchema = z
  .object({
    sql: z.string().min(1).openapi({
      description: "The statements; several are run one by one and the result belongs to the last",
    }),
    params: z
      .array(z.union([z.string(), z.float64(), z.boolean()]).nullable())
      .readonly()
      .exactOptional()
      .openapi({
        description: "The values bound to the placeholders, in order; omitted means none",
      }),
  })
  .readonly()
  .openapi({ required: ["sql"], description: "Statements for the SQL console." })
  .openapi("SqlBody");

export const SqlDialectSchema = z
  .enum(["sqlite", "postgresql", "mysql"])
  .openapi({ description: "The dialect a database speaks." })
  .openapi("SqlDialect");

export const PlanNodeSchema = z
  .object({
    id: z.string().openapi({ description: "The step id, unique within the plan" }),
    parent: z
      .string()
      .nullable()
      .openapi({ description: "The id of the step this one feeds, or null for a root" }),
    label: z.string().openapi({
      description: "What the step does (`SCAN users`, `Seq Scan on users`, `Hash Join`)",
    }),
    detail: z
      .string()
      .nullable()
      .openapi({ description: "The rest of what the database said about the step" }),
    cost: z
      .float64()
      .nullable()
      .openapi({ description: "The estimated cost, when the database reports one" }),
    rows: z.float64().nullable().openapi({
      description: "The estimated (or, with ANALYZE, actual) row count, when reported",
    }),
  })
  .readonly()
  .openapi({
    required: ["id", "parent", "label", "detail", "cost", "rows"],
    description: "One step of the execution plan, flattened; `parent` rebuilds the tree.",
    example: { id: "3", parent: null, label: "SCAN users", detail: null, cost: null, rows: null },
  })
  .openapi("PlanNode");

export const PlanSchema = z
  .object({
    dialect: SqlDialectSchema.openapi({ description: "The dialect that produced the plan" }),
    nodes: z
      .array(PlanNodeSchema)
      .readonly()
      .openapi({ description: "The steps, parents before children" }),
    raw: z.string().openapi({ description: "The plan as the database printed it" }),
  })
  .readonly()
  .openapi({
    required: ["dialect", "nodes", "raw"],
    description: "The execution plan of a statement.",
    example: { dialect: "sqlite", nodes: [], raw: "" },
  })
  .openapi("Plan");

export const StatementKindSchema = z
  .enum(["select", "insert", "update", "delete", "other", "invalid"])
  .openapi({ description: "What kind of statement was analyzed." })
  .openapi("StatementKind");

export const TextRangeSchema = z
  .object({
    start: z.int32().openapi({ description: "Where it starts" }),
    end: z.int32().openapi({ description: "Where it ends" }),
  })
  .readonly()
  .openapi({
    required: ["start", "end"],
    description: "A stretch of the source, as UTF-16 offsets.",
  })
  .openapi("TextRange");

export const NodeKindSchema = z
  .enum([
    "table",
    "cte",
    "subquery",
    "values",
    "function",
    "join",
    "filter",
    "aggregate",
    "having",
    "project",
    "distinct",
    "sort",
    "limit",
    "union",
    "insert",
    "update",
    "delete",
    "returning",
  ])
  .openapi({ description: "What a node of the data-flow graph stands for." })
  .openapi("NodeKind");

export const NodeColumnSchema = z
  .object({
    name: z.string().openapi({ description: "The column name" }),
    dataType: z.string().nullable().openapi({ description: "The declared type, when known" }),
    used: z.boolean().openapi({
      description:
        "Whether the statement reads the column (for a table), or always true for a result",
    }),
  })
  .readonly()
  .openapi({
    required: ["name", "dataType", "used"],
    description: "A column a node produces.",
    example: { name: "email", dataType: "TEXT", used: true },
  })
  .openapi("NodeColumn");

export const GraphNodeSchema = z
  .object({
    id: z.string().openapi({ description: "The node id, unique within the statement" }),
    kind: NodeKindSchema.openapi({ description: "What the node stands for" }),
    label: z.string().openapi({ description: "The caption (`users AS u`, `LEFT JOIN`, `WHERE`)" }),
    details: z.array(z.string()).readonly().openapi({
      description: "Lines under the caption: the condition, the grouped keys, the column names",
    }),
    range: TextRangeSchema.nullable().openapi({
      description: "Where the node's clause sits in the text, when it has one",
    }),
    scope: z
      .string()
      .openapi({ description: "`main`, or the CTE / subquery alias the node belongs to" }),
    columns: z.array(NodeColumnSchema).readonly().openapi({
      description: "The columns the node produces (tables, CTEs, subqueries and projections)",
    }),
  })
  .readonly()
  .openapi({
    required: ["id", "kind", "label", "details", "range", "scope", "columns"],
    description: "A node of the data-flow graph.",
    example: {
      id: "n3",
      kind: "filter",
      label: "WHERE",
      details: ["u.id = ?"],
      range: { start: 40, end: 48 },
      scope: "main",
      columns: [],
    },
  })
  .openapi("GraphNode");

export const EdgeKindSchema = z
  .enum(["flow", "lookup"])
  .openapi({ description: "How rows travel along an edge." })
  .openapi("EdgeKind");

export const GraphEdgeSchema = z
  .object({
    id: z.string().openapi({ description: "The edge id, unique within the statement" }),
    source: z.string().openapi({ description: "The node rows come from" }),
    target: z.string().openapi({ description: "The node rows go to" }),
    label: z.string().nullable().openapi({
      description:
        "A caption (`optional` for the outer side of a join, `scalar` for a scalar subquery)",
    }),
    kind: EdgeKindSchema.openapi({ description: "How rows travel" }),
  })
  .readonly()
  .openapi({
    required: ["id", "source", "target", "label", "kind"],
    description: "An edge of the data-flow graph.",
    example: { id: "n1->n3:0", source: "n1", target: "n3", label: null, kind: "flow" },
  })
  .openapi("GraphEdge");

export const TableRefSchema = z
  .object({
    nodeId: z.string().openapi({ description: "The graph node of this reference" }),
    name: z.string().openapi({ description: "The table name as written" }),
    alias: z.string().nullable().openapi({ description: "The alias, when one was given" }),
    scope: z
      .string()
      .openapi({ description: "`main`, or the CTE / subquery alias the reference sits in" }),
    known: z.boolean().openapi({ description: "Whether the schema has the table" }),
    columnsUsed: z
      .array(z.string())
      .readonly()
      .openapi({ description: "The columns the statement reads from this reference" }),
    range: TextRangeSchema.openapi({ description: "Where the name sits in the text" }),
  })
  .readonly()
  .openapi({
    required: ["nodeId", "name", "alias", "scope", "known", "columnsUsed", "range"],
    description: "A table the statement reads or writes.",
    example: {
      nodeId: "n1",
      name: "users",
      alias: "u",
      scope: "main",
      known: true,
      columnsUsed: ["id", "email"],
      range: { start: 20, end: 25 },
    },
  })
  .openapi("TableRef");

export const ColumnSourceSchema = z
  .object({
    table: z.string().openapi({ description: "The base table" }),
    column: z.string().openapi({ description: "The column of that table" }),
  })
  .readonly()
  .openapi({
    required: ["table", "column"],
    description: "A base-table column an output column derives from.",
    example: { table: "users", column: "email" },
  })
  .openapi("ColumnSource");

export const OutputColumnSchema = z
  .object({
    name: z.string().openapi({ description: "The name a driver keys the row with" }),
    expression: z.string().openapi({ description: "The expression as written" }),
    dataType: z.string().nullable().openapi({ description: "The declared type, when known" }),
    tsType: z.string().openapi({ description: "The TypeScript type of the value" }),
    nullable: z
      .boolean()
      .nullable()
      .openapi({ description: "Whether NULL can come back; null when the analysis cannot tell" }),
    sources: z
      .array(ColumnSourceSchema)
      .readonly()
      .openapi({ description: "The base-table columns the value derives from" }),
  })
  .readonly()
  .openapi({
    required: ["name", "expression", "dataType", "tsType", "nullable", "sources"],
    description: "A column of the result, with its lineage and type.",
    example: {
      name: "email",
      expression: "u.email",
      dataType: "TEXT",
      tsType: "string",
      nullable: true,
      sources: [{ table: "users", column: "email" }],
    },
  })
  .openapi("OutputColumn");

export const SqlParameterSchema = z
  .object({
    index: z.int32().openapi({ description: "The bind position (1-based), or the `$n` number" }),
    placeholder: z
      .string()
      .openapi({ description: "The placeholder as written (`?`, `$1`, `:name`)" }),
    dataType: z
      .string()
      .nullable()
      .openapi({ description: "The declared type of the column it is compared with, when known" }),
    tsType: z.string().openapi({ description: "The TypeScript type a value should have" }),
    nullable: z.boolean().nullable().openapi({
      description: "Whether NULL is a valid value; null when the analysis cannot tell",
    }),
    context: z.string().openapi({ description: "The expression the placeholder sits in" }),
  })
  .readonly()
  .openapi({
    required: ["index", "placeholder", "dataType", "tsType", "nullable", "context"],
    description: "A placeholder and the type of what it stands beside.",
    example: {
      index: 1,
      placeholder: "?",
      dataType: "INTEGER",
      tsType: "number",
      nullable: false,
      context: "u.id = ?",
    },
  })
  .openapi("SqlParameter");

export const SqlSeveritySchema = z
  .enum(["error", "warning", "info"])
  .openapi({ description: "How serious a problem the analysis found is." })
  .openapi("SqlSeverity");

export const SqlDiagnosticSchema = z
  .object({
    severity: SqlSeveritySchema.openapi({ description: "How serious it is" }),
    message: z.string().openapi({ description: "What is wrong" }),
    range: TextRangeSchema.nullable().openapi({
      description: "Where, when the analysis can point at it",
    }),
  })
  .readonly()
  .openapi({
    required: ["severity", "message", "range"],
    description: "A problem found in the statement.",
    example: {
      severity: "warning",
      message: 'Unknown column "nmae"',
      range: { start: 7, end: 11 },
    },
  })
  .openapi("SqlDiagnostic");

export const StatementAnalysisSchema = z
  .object({
    kind: StatementKindSchema.openapi({ description: "What kind of statement it is" }),
    text: z.string().openapi({ description: "The statement text" }),
    range: TextRangeSchema.openapi({
      description: "Where the statement sits in the submitted text",
    }),
    nodes: z
      .array(GraphNodeSchema)
      .readonly()
      .openapi({ description: "The nodes of the data-flow graph" }),
    edges: z
      .array(GraphEdgeSchema)
      .readonly()
      .openapi({ description: "The edges of the data-flow graph" }),
    tables: z
      .array(TableRefSchema)
      .readonly()
      .openapi({ description: "Every table the statement touches" }),
    columns: z
      .array(OutputColumnSchema)
      .readonly()
      .openapi({ description: "The columns of the result (empty for a write without RETURNING)" }),
    parameters: z
      .array(SqlParameterSchema)
      .readonly()
      .openapi({ description: "The placeholders, in bind order" }),
    diagnostics: z
      .array(SqlDiagnosticSchema)
      .readonly()
      .openapi({ description: "What was found wrong" }),
    rowType: z.string().openapi({
      description: "The row type as TypeScript (`{ id: number; email: string | null }`)",
    }),
    paramsType: z.string().openapi({
      description: "The parameter tuple (or object, for named placeholders) as TypeScript",
    }),
  })
  .readonly()
  .openapi({
    required: [
      "kind",
      "text",
      "range",
      "nodes",
      "edges",
      "tables",
      "columns",
      "parameters",
      "diagnostics",
      "rowType",
      "paramsType",
    ],
    description: "The analysis of one statement.",
  })
  .openapi("StatementAnalysis");

export const AnalysisSchema = z
  .object({
    statements: z
      .array(StatementAnalysisSchema)
      .readonly()
      .openapi({ description: "One entry per statement, in order" }),
  })
  .readonly()
  .openapi({
    required: ["statements"],
    description: "The analysis of every statement in the text.",
  })
  .openapi("Analysis");

export const AnalyzeBodySchema = z
  .object({ sql: z.string().min(1).openapi({ description: "The statements" }) })
  .readonly()
  .openapi({
    required: ["sql"],
    description: "Text to analyze.",
    example: { sql: "SELECT id, email FROM users WHERE id = ?" },
  })
  .openapi("AnalyzeBody");

export const LanguageStatusSchema = z
  .object({
    typescript: z.string().nullable().openapi({
      description: "The version of the project's TypeScript, null when it could not be loaded",
    }),
    reason: z
      .string()
      .nullable()
      .openapi({ description: "Why there is no language service, null when there is one" }),
  })
  .readonly()
  .openapi({
    required: ["typescript", "reason"],
    description: "Whether the editor has TypeScript behind it.",
  })
  .openapi("LanguageStatus");

export const CompletionItemSchema = z
  .object({
    label: z.string().openapi({ description: "What is shown and inserted" }),
    kind: z.string().openapi({
      description: "TypeScript's kind of the entry: `method`, `property`, `function`, ...",
    }),
    sortText: z.string().openapi({ description: "How TypeScript orders it" }),
    insertText: z
      .string()
      .nullable()
      .openapi({ description: "Text to insert in place of the label, when it differs" }),
    replacement: TextRangeSchema.nullable().openapi({
      description: "The text the completion replaces, when it is not the word at the cursor",
    }),
  })
  .readonly()
  .openapi({
    required: ["label", "kind", "sortText", "insertText", "replacement"],
    description: "One thing TypeScript offers at the cursor.",
  })
  .openapi("CompletionItem");

export const CompletionsSchema = z
  .object({
    items: z
      .array(CompletionItemSchema)
      .readonly()
      .openapi({ description: "The items, in TypeScript's order" }),
  })
  .readonly()
  .openapi({ required: ["items"], description: "The completions at the cursor." })
  .openapi("Completions");

export const PositionBodySchema = z
  .object({
    source: z.string().openapi({ description: "The schema source, saved or not, or the query" }),
    document: DocumentKindSchema.exactOptional().openapi({
      description: "Which editor it comes from; the schema when left out",
    }),
    offset: z.int32().min(0).openapi({ description: "The UTF-16 offset of the cursor" }),
  })
  .readonly()
  .openapi({ required: ["source", "offset"], description: "The editor buffer and a place in it." })
  .openapi("PositionBody");

export const CompletionDetailSchema = z
  .object({
    detail: z.string().nullable().openapi({ description: "Its signature or type" }),
    documentation: z.string().nullable().openapi({ description: "Its doc comment, as Markdown" }),
  })
  .readonly()
  .openapi({
    required: ["detail", "documentation"],
    description: "The type and documentation of one completion.",
  })
  .openapi("CompletionDetail");

export const CompletionDetailBodySchema = z
  .object({
    source: z.string().openapi({ description: "The schema source, saved or not, or the query" }),
    document: DocumentKindSchema.exactOptional().openapi({
      description: "Which editor it comes from; the schema when left out",
    }),
    offset: z.int32().min(0).openapi({ description: "The UTF-16 offset of the cursor" }),
    name: z.string().openapi({ description: "The name of the completion" }),
  })
  .readonly()
  .openapi({
    required: ["source", "offset", "name"],
    description: "A completion to describe in full.",
  })
  .openapi("CompletionDetailBody");

export const HoverSchema = z
  .object({
    contents: z
      .string()
      .nullable()
      .openapi({ description: "The type and documentation, as Markdown; null over nothing" }),
    range: TextRangeSchema.nullable().openapi({ description: "The symbol's range" }),
  })
  .readonly()
  .openapi({
    required: ["contents", "range"],
    description: "What TypeScript says about the symbol at the cursor.",
  })
  .openapi("Hover");

export const SignatureParameterSchema = z
  .object({
    label: z.string().openapi({ description: "How it reads in the signature" }),
    documentation: z.string().nullable().openapi({ description: "Its doc comment" }),
  })
  .readonly()
  .openapi({ required: ["label", "documentation"], description: "One parameter of a signature." })
  .openapi("SignatureParameter");

export const SignatureSchema = z
  .object({
    label: z.string().openapi({ description: "The whole signature" }),
    documentation: z.string().nullable().openapi({ description: "Its doc comment" }),
    parameters: z
      .array(SignatureParameterSchema)
      .readonly()
      .openapi({ description: "Its parameters" }),
  })
  .readonly()
  .openapi({
    required: ["label", "documentation", "parameters"],
    description: "One overload of the call.",
  })
  .openapi("Signature");

export const SignatureHelpSchema = z
  .object({
    signatures: z.array(SignatureSchema).readonly().openapi({ description: "The overloads" }),
    activeSignature: z.int32().openapi({ description: "The overload TypeScript picked" }),
    activeParameter: z.int32().openapi({ description: "The parameter the cursor is on" }),
  })
  .readonly()
  .openapi({
    required: ["signatures", "activeSignature", "activeParameter"],
    description: "The signatures of the call the cursor is in.",
  })
  .openapi("SignatureHelp");

export const DiagnosticSchema = z
  .object({
    message: z.string().openapi({ description: "What is wrong" }),
    severity: z.enum(["error", "warning", "info"]).openapi({ description: "How bad it is" }),
    range: TextRangeSchema.openapi({ description: "Where it is" }),
  })
  .readonly()
  .openapi({
    required: ["message", "severity", "range"],
    description: "One problem TypeScript found.",
  })
  .openapi("Diagnostic");

export const DiagnosticsSchema = z
  .object({
    diagnostics: z
      .array(DiagnosticSchema)
      .readonly()
      .openapi({ description: "The problems, in order of position" }),
  })
  .readonly()
  .openapi({
    required: ["diagnostics"],
    description:
      "The type errors of a source; its syntax errors come from the parser, with the diagram.",
  })
  .openapi("Diagnostics");

export const ExecutedStatementSchema = z
  .object({
    sql: z.string().openapi({ description: "The SQL" }),
    params: z.array(z.any()).readonly().openapi({ description: "Its parameters" }),
    rowCount: z.int32().openapi({ description: "Rows returned, or changed by a write" }),
    durationMs: z.float64().openapi({ description: "How long it took" }),
  })
  .readonly()
  .openapi({
    required: ["sql", "params", "rowCount", "durationMs"],
    description: "One statement Drizzle sent to the database.",
  })
  .openapi("ExecutedStatement");

export const QueryResultSchema = z
  .object({
    result: z.any().openapi({ description: "The value of the query, as JSON; null when it threw" }),
    error: z
      .string()
      .nullable()
      .openapi({ description: "The message it threw, null when it did not" }),
    statements: z
      .array(ExecutedStatementSchema)
      .readonly()
      .openapi({ description: "The statements, in the order they ran" }),
    durationMs: z.float64().openapi({ description: "How long the query took in all" }),
  })
  .readonly()
  .openapi({
    required: ["result", "error", "statements", "durationMs"],
    description: "What a query gave, and what the database was asked on the way.",
  })
  .openapi("QueryResult");

export const QueryBodySchema = z
  .object({
    code: z.string().min(1).openapi({
      description:
        "The body of an async function with `db`, the schema's exports and drizzle-orm's operators\nin scope; its last expression is the result.",
    }),
  })
  .readonly()
  .openapi({ required: ["code"], description: "Drizzle code to run." })
  .openapi("QueryBody");

export const TouchedTableSchema = z
  .object({
    table: z.string().openapi({ description: "The table's exported name" }),
    columns: z
      .array(z.string())
      .readonly()
      .openapi({ description: "The columns the code names on it, as `table.column`" }),
    write: z.boolean().openapi({
      description:
        "Whether the code writes to it: `db.insert(table)`, `db.update(table)` or `db.delete(table)`",
    }),
  })
  .readonly()
  .openapi({
    required: ["table", "columns", "write"],
    description: "A table Drizzle code touches.",
  })
  .openapi("TouchedTable");

export const QueryTouchedSchema = z
  .object({
    tables: z.array(TouchedTableSchema).readonly().openapi({
      description:
        "The tables read by name, through `db.query`, or reached by a `with`; empty when the code does not parse",
    }),
  })
  .readonly()
  .openapi({
    required: ["tables"],
    description: "The tables Drizzle code touches, for the diagram beside the editor to light up.",
  })
  .openapi("QueryTouched");

export const TouchedBodySchema = z
  .object({ code: z.string().openapi({ description: "The code as the editor holds it" }) })
  .readonly()
  .openapi({
    required: ["code"],
    description: "Drizzle code, written or being written, to read the tables of.",
  })
  .openapi("TouchedBody");

const RowsQuerySkipParamsSchema = SkipSchema.openapi({
  param: {
    name: "skip",
    in: "query",
    required: true,
    description: "Rows to skip before the page",
    schema: { $ref: "#/components/schemas/skip" },
    explode: false,
  },
});

const RowsQueryTakeParamsSchema = TakeSchema.openapi({
  param: {
    name: "take",
    in: "query",
    required: true,
    description: "Rows per page",
    schema: { $ref: "#/components/schemas/take" },
    explode: false,
  },
});

const RowsQuerySearchParamsSchema = z
  .string()
  .exactOptional()
  .openapi({
    param: {
      name: "search",
      in: "query",
      required: false,
      description:
        "Text to look for in any column, case-insensitively; empty or absent reads every row",
      schema: { type: "string" },
      explode: false,
    },
  });

export const getSchemaRoute = createRoute({
  method: "get",
  path: "/schema",
  tags: ["schema"],
  description: "The schema file as it is on disk.",
  operationId: "readSchema",
  responses: {
    200: {
      description: "The request has succeeded.",
      content: { "application/json": { schema: SnapshotSchema } },
    },
    500: {
      description: "500 Internal Server Error (`application/problem+json`)",
      content: { "application/problem+json": { schema: InternalServerProblemSchema } },
    },
  },
} as const);

export const putSchemaRoute = createRoute({
  method: "put",
  path: "/schema",
  tags: ["schema"],
  description: "Write the schema file.",
  operationId: "writeSchema",
  request: {
    body: { content: { "application/json": { schema: SaveBodySchema } }, required: true },
  },
  responses: {
    200: {
      description: "The request has succeeded.",
      content: { "application/json": { schema: SnapshotSchema } },
    },
    422: {
      description: "422 Unprocessable Content (`application/problem+json`)",
      content: { "application/problem+json": { schema: ValidationProblemSchema } },
    },
    500: {
      description: "500 Internal Server Error (`application/problem+json`)",
      content: { "application/problem+json": { schema: InternalServerProblemSchema } },
    },
  },
} as const);

export const getSchemaEventsRoute = createRoute({
  method: "get",
  path: "/schema/events",
  tags: ["schema"],
  description: "A `change` event whenever the schema file changes on disk.",
  operationId: "readSchemaEvents",
  responses: {
    200: {
      description: "The request has succeeded.",
      content: { "text/event-stream": { schema: z.string() } },
    },
  },
} as const);

export const postDiagramSchemaRoute = createRoute({
  method: "post",
  path: "/diagram/schema",
  tags: ["diagram"],
  description:
    "The ER diagram of a schema as data: tables, relations, enums and where each table is declared.",
  operationId: "drawSchema",
  request: {
    body: { content: { "application/json": { schema: SourceBodySchema } }, required: true },
  },
  responses: {
    200: {
      description: "The request has succeeded.",
      content: { "application/json": { schema: DiagramDataSchema } },
    },
    422: {
      description: "422 Unprocessable Content (`application/problem+json`)",
      content: { "application/problem+json": { schema: ValidationProblemSchema } },
    },
    500: {
      description: "500 Internal Server Error (`application/problem+json`)",
      content: { "application/problem+json": { schema: InternalServerProblemSchema } },
    },
  },
} as const);

export const postDiagramSvgRoute = createRoute({
  method: "post",
  path: "/diagram/svg",
  tags: ["diagram"],
  description: "The ER diagram of a schema as SVG.",
  operationId: "drawSvg",
  request: {
    body: { content: { "application/json": { schema: DiagramBodySchema } }, required: true },
  },
  responses: {
    200: {
      description: "The request has succeeded.",
      content: { "application/json": { schema: DiagramSchema } },
    },
    422: {
      description: "422 Unprocessable Content (`application/problem+json`)",
      content: { "application/problem+json": { schema: ValidationProblemSchema } },
    },
    500: {
      description: "500 Internal Server Error (`application/problem+json`)",
      content: { "application/problem+json": { schema: InternalServerProblemSchema } },
    },
  },
} as const);

export const postDiagramPngRoute = createRoute({
  method: "post",
  path: "/diagram/png",
  tags: ["diagram"],
  description: "The ER diagram of a schema as PNG.",
  operationId: "drawPng",
  request: {
    body: { content: { "application/json": { schema: DiagramBodySchema } }, required: true },
  },
  responses: {
    200: {
      description: "The request has succeeded.",
      content: { "application/json": { schema: PngSchema } },
    },
    422: {
      description: "422 Unprocessable Content (`application/problem+json`)",
      content: { "application/problem+json": { schema: ValidationProblemSchema } },
    },
    500: {
      description: "500 Internal Server Error (`application/problem+json`)",
      content: { "application/problem+json": { schema: InternalServerProblemSchema } },
    },
  },
} as const);

export const postFormatRoute = createRoute({
  method: "post",
  path: "/format",
  tags: ["format"],
  description: "Format a schema with oxfmt; a source that does not parse is a 422.",
  operationId: "formatSource",
  request: {
    body: { content: { "application/json": { schema: FormatBodySchema } }, required: true },
  },
  responses: {
    200: {
      description: "The request has succeeded.",
      content: { "application/json": { schema: FormattedSchema } },
    },
    422: {
      description: "422 Unprocessable Content (`application/problem+json`)",
      content: { "application/problem+json": { schema: ValidationProblemSchema } },
    },
    500: {
      description: "500 Internal Server Error (`application/problem+json`)",
      content: { "application/problem+json": { schema: InternalServerProblemSchema } },
    },
  },
} as const);

export const getDocsRoute = createRoute({
  method: "get",
  path: "/docs",
  tags: ["docs"],
  description: "The generated documentation of the saved schema.",
  operationId: "readDocs",
  responses: {
    200: {
      description: "The request has succeeded.",
      content: { "application/json": { schema: DocsSchema } },
    },
    500: {
      description: "500 Internal Server Error (`application/problem+json`)",
      content: { "application/problem+json": { schema: InternalServerProblemSchema } },
    },
  },
} as const);

export const getDbRoute = createRoute({
  method: "get",
  path: "/db",
  tags: ["db"],
  description: "The database connection and the tables of the schema.",
  operationId: "readDbStatus",
  responses: {
    200: {
      description: "The request has succeeded.",
      content: { "application/json": { schema: DbStatusSchema } },
    },
    500: {
      description: "500 Internal Server Error (`application/problem+json`)",
      content: { "application/problem+json": { schema: InternalServerProblemSchema } },
    },
  },
} as const);

export const getDbCountsRoute = createRoute({
  method: "get",
  path: "/db/counts",
  tags: ["db"],
  description: "The row count of every table.",
  operationId: "readCounts",
  responses: {
    200: {
      description: "The request has succeeded.",
      content: { "application/json": { schema: CountsSchema } },
    },
    500: {
      description: "500 Internal Server Error (`application/problem+json`)",
      content: { "application/problem+json": { schema: InternalServerProblemSchema } },
    },
    503: {
      description: "503 Service Unavailable (`application/problem+json`)",
      content: { "application/problem+json": { schema: ServiceUnavailableProblemSchema } },
    },
  },
} as const);

export const getDbRowsTableNameRoute = createRoute({
  method: "get",
  path: "/db/rows/{tableName}",
  tags: ["db"],
  description: "One page of a table's rows, ordered by its key.",
  operationId: "readRows",
  request: {
    params: z.object({
      tableName: TableNameSchema.openapi({
        param: {
          name: "tableName",
          in: "path",
          required: true,
          schema: { $ref: "#/components/schemas/tableName" },
        },
      }),
    }),
    query: z.object({
      skip: RowsQuerySkipParamsSchema,
      take: RowsQueryTakeParamsSchema,
      search: RowsQuerySearchParamsSchema,
    }),
  },
  responses: {
    200: {
      description: "The request has succeeded.",
      content: { "application/json": { schema: RowsSchema } },
    },
    404: {
      description: "404 Not Found (`application/problem+json`)",
      content: { "application/problem+json": { schema: NotFoundProblemSchema } },
    },
    422: {
      description: "422 Unprocessable Content (`application/problem+json`)",
      content: { "application/problem+json": { schema: ValidationProblemSchema } },
    },
    500: {
      description: "500 Internal Server Error (`application/problem+json`)",
      content: { "application/problem+json": { schema: InternalServerProblemSchema } },
    },
    503: {
      description: "503 Service Unavailable (`application/problem+json`)",
      content: { "application/problem+json": { schema: ServiceUnavailableProblemSchema } },
    },
  },
} as const);

export const postDbRowsTableNameRoute = createRoute({
  method: "post",
  path: "/db/rows/{tableName}",
  tags: ["db"],
  description: "Insert one row.",
  operationId: "createRow",
  request: {
    params: z.object({
      tableName: TableNameSchema.openapi({
        param: {
          name: "tableName",
          in: "path",
          required: true,
          schema: { $ref: "#/components/schemas/tableName" },
        },
      }),
    }),
    body: { content: { "application/json": { schema: InsertBodySchema } }, required: true },
  },
  responses: {
    200: {
      description: "The request has succeeded.",
      content: { "application/json": { schema: AffectedSchema } },
    },
    404: {
      description: "404 Not Found (`application/problem+json`)",
      content: { "application/problem+json": { schema: NotFoundProblemSchema } },
    },
    422: {
      description: "422 Unprocessable Content (`application/problem+json`)",
      content: { "application/problem+json": { schema: ValidationProblemSchema } },
    },
    500: {
      description: "500 Internal Server Error (`application/problem+json`)",
      content: { "application/problem+json": { schema: InternalServerProblemSchema } },
    },
    503: {
      description: "503 Service Unavailable (`application/problem+json`)",
      content: { "application/problem+json": { schema: ServiceUnavailableProblemSchema } },
    },
  },
} as const);

export const deleteDbRowsTableNameRoute = createRoute({
  method: "delete",
  path: "/db/rows/{tableName}",
  tags: ["db"],
  description: "Delete the row identified by `where`.",
  operationId: "deleteRow",
  request: {
    params: z.object({
      tableName: TableNameSchema.openapi({
        param: {
          name: "tableName",
          in: "path",
          required: true,
          schema: { $ref: "#/components/schemas/tableName" },
        },
      }),
    }),
    body: { content: { "application/json": { schema: DeleteBodySchema } }, required: true },
  },
  responses: {
    200: {
      description: "The request has succeeded.",
      content: { "application/json": { schema: AffectedSchema } },
    },
    404: {
      description: "404 Not Found (`application/problem+json`)",
      content: { "application/problem+json": { schema: NotFoundProblemSchema } },
    },
    422: {
      description: "422 Unprocessable Content (`application/problem+json`)",
      content: { "application/problem+json": { schema: ValidationProblemSchema } },
    },
    500: {
      description: "500 Internal Server Error (`application/problem+json`)",
      content: { "application/problem+json": { schema: InternalServerProblemSchema } },
    },
    503: {
      description: "503 Service Unavailable (`application/problem+json`)",
      content: { "application/problem+json": { schema: ServiceUnavailableProblemSchema } },
    },
  },
} as const);

export const patchDbRowsTableNameRoute = createRoute({
  method: "patch",
  path: "/db/rows/{tableName}",
  tags: ["db"],
  description: "Update the row identified by `where`.",
  operationId: "updateRow",
  request: {
    params: z.object({
      tableName: TableNameSchema.openapi({
        param: {
          name: "tableName",
          in: "path",
          required: true,
          schema: { $ref: "#/components/schemas/tableName" },
        },
      }),
    }),
    body: { content: { "application/json": { schema: UpdateBodySchema } }, required: true },
  },
  responses: {
    200: {
      description: "The request has succeeded.",
      content: { "application/json": { schema: AffectedSchema } },
    },
    404: {
      description: "404 Not Found (`application/problem+json`)",
      content: { "application/problem+json": { schema: NotFoundProblemSchema } },
    },
    422: {
      description: "422 Unprocessable Content (`application/problem+json`)",
      content: { "application/problem+json": { schema: ValidationProblemSchema } },
    },
    500: {
      description: "500 Internal Server Error (`application/problem+json`)",
      content: { "application/problem+json": { schema: InternalServerProblemSchema } },
    },
    503: {
      description: "503 Service Unavailable (`application/problem+json`)",
      content: { "application/problem+json": { schema: ServiceUnavailableProblemSchema } },
    },
  },
} as const);

export const postDbSqlRoute = createRoute({
  method: "post",
  path: "/db/sql",
  tags: ["db"],
  description: "Run the statements one by one; the result is the last one's, the time the whole's.",
  operationId: "runSql",
  request: { body: { content: { "application/json": { schema: SqlBodySchema } }, required: true } },
  responses: {
    200: {
      description: "The request has succeeded.",
      content: { "application/json": { schema: SqlResultSchema } },
    },
    422: {
      description: "422 Unprocessable Content (`application/problem+json`)",
      content: { "application/problem+json": { schema: ValidationProblemSchema } },
    },
    500: {
      description: "500 Internal Server Error (`application/problem+json`)",
      content: { "application/problem+json": { schema: InternalServerProblemSchema } },
    },
    503: {
      description: "503 Service Unavailable (`application/problem+json`)",
      content: { "application/problem+json": { schema: ServiceUnavailableProblemSchema } },
    },
  },
} as const);

export const postDbExplainRoute = createRoute({
  method: "post",
  path: "/db/explain",
  tags: ["db"],
  description: "The execution plan the database chooses for the first statement of the text.",
  operationId: "explainSql",
  request: { body: { content: { "application/json": { schema: SqlBodySchema } }, required: true } },
  responses: {
    200: {
      description: "The request has succeeded.",
      content: { "application/json": { schema: PlanSchema } },
    },
    422: {
      description: "422 Unprocessable Content (`application/problem+json`)",
      content: { "application/problem+json": { schema: ValidationProblemSchema } },
    },
    500: {
      description: "500 Internal Server Error (`application/problem+json`)",
      content: { "application/problem+json": { schema: InternalServerProblemSchema } },
    },
    503: {
      description: "503 Service Unavailable (`application/problem+json`)",
      content: { "application/problem+json": { schema: ServiceUnavailableProblemSchema } },
    },
  },
} as const);

export const postDbAnalyzeRoute = createRoute({
  method: "post",
  path: "/db/analyze",
  tags: ["db"],
  description:
    "Analyze the statements against the saved schema's tables: data flow, lineage, row type, parameters and problems.",
  operationId: "analyzeSql",
  request: {
    body: { content: { "application/json": { schema: AnalyzeBodySchema } }, required: true },
  },
  responses: {
    200: {
      description: "The request has succeeded.",
      content: { "application/json": { schema: AnalysisSchema } },
    },
    422: {
      description: "422 Unprocessable Content (`application/problem+json`)",
      content: { "application/problem+json": { schema: ValidationProblemSchema } },
    },
    500: {
      description: "500 Internal Server Error (`application/problem+json`)",
      content: { "application/problem+json": { schema: InternalServerProblemSchema } },
    },
  },
} as const);

export const getLanguageRoute = createRoute({
  method: "get",
  path: "/language",
  tags: ["language"],
  description: "Whether the project's TypeScript is loaded, and why not when it is not.",
  operationId: "readLanguageStatus",
  responses: {
    200: {
      description: "The request has succeeded.",
      content: { "application/json": { schema: LanguageStatusSchema } },
    },
    500: {
      description: "500 Internal Server Error (`application/problem+json`)",
      content: { "application/problem+json": { schema: InternalServerProblemSchema } },
    },
  },
} as const);

export const postLanguageCompleteRoute = createRoute({
  method: "post",
  path: "/language/complete",
  tags: ["language"],
  description: "The completions at the cursor.",
  operationId: "complete",
  request: {
    body: { content: { "application/json": { schema: PositionBodySchema } }, required: true },
  },
  responses: {
    200: {
      description: "The request has succeeded.",
      content: { "application/json": { schema: CompletionsSchema } },
    },
    422: {
      description: "422 Unprocessable Content (`application/problem+json`)",
      content: { "application/problem+json": { schema: ValidationProblemSchema } },
    },
    500: {
      description: "500 Internal Server Error (`application/problem+json`)",
      content: { "application/problem+json": { schema: InternalServerProblemSchema } },
    },
    503: {
      description: "503 Service Unavailable (`application/problem+json`)",
      content: { "application/problem+json": { schema: ServiceUnavailableProblemSchema } },
    },
  },
} as const);

export const postLanguageCompleteDetailRoute = createRoute({
  method: "post",
  path: "/language/complete/detail",
  tags: ["language"],
  description: "The type and documentation of one completion.",
  operationId: "completeDetail",
  request: {
    body: {
      content: { "application/json": { schema: CompletionDetailBodySchema } },
      required: true,
    },
  },
  responses: {
    200: {
      description: "The request has succeeded.",
      content: { "application/json": { schema: CompletionDetailSchema } },
    },
    422: {
      description: "422 Unprocessable Content (`application/problem+json`)",
      content: { "application/problem+json": { schema: ValidationProblemSchema } },
    },
    500: {
      description: "500 Internal Server Error (`application/problem+json`)",
      content: { "application/problem+json": { schema: InternalServerProblemSchema } },
    },
    503: {
      description: "503 Service Unavailable (`application/problem+json`)",
      content: { "application/problem+json": { schema: ServiceUnavailableProblemSchema } },
    },
  },
} as const);

export const postLanguageHoverRoute = createRoute({
  method: "post",
  path: "/language/hover",
  tags: ["language"],
  description: "What TypeScript says about the symbol at the cursor.",
  operationId: "hover",
  request: {
    body: { content: { "application/json": { schema: PositionBodySchema } }, required: true },
  },
  responses: {
    200: {
      description: "The request has succeeded.",
      content: { "application/json": { schema: HoverSchema } },
    },
    422: {
      description: "422 Unprocessable Content (`application/problem+json`)",
      content: { "application/problem+json": { schema: ValidationProblemSchema } },
    },
    500: {
      description: "500 Internal Server Error (`application/problem+json`)",
      content: { "application/problem+json": { schema: InternalServerProblemSchema } },
    },
    503: {
      description: "503 Service Unavailable (`application/problem+json`)",
      content: { "application/problem+json": { schema: ServiceUnavailableProblemSchema } },
    },
  },
} as const);

export const postLanguageSignatureRoute = createRoute({
  method: "post",
  path: "/language/signature",
  tags: ["language"],
  description: "The signatures of the call the cursor is in.",
  operationId: "signature",
  request: {
    body: { content: { "application/json": { schema: PositionBodySchema } }, required: true },
  },
  responses: {
    200: {
      description: "The request has succeeded.",
      content: { "application/json": { schema: SignatureHelpSchema } },
    },
    422: {
      description: "422 Unprocessable Content (`application/problem+json`)",
      content: { "application/problem+json": { schema: ValidationProblemSchema } },
    },
    500: {
      description: "500 Internal Server Error (`application/problem+json`)",
      content: { "application/problem+json": { schema: InternalServerProblemSchema } },
    },
    503: {
      description: "503 Service Unavailable (`application/problem+json`)",
      content: { "application/problem+json": { schema: ServiceUnavailableProblemSchema } },
    },
  },
} as const);

export const postLanguageDiagnosticsRoute = createRoute({
  method: "post",
  path: "/language/diagnostics",
  tags: ["language"],
  description: "The type errors of the source.",
  operationId: "diagnostics",
  request: {
    body: { content: { "application/json": { schema: SourceBodySchema } }, required: true },
  },
  responses: {
    200: {
      description: "The request has succeeded.",
      content: { "application/json": { schema: DiagnosticsSchema } },
    },
    422: {
      description: "422 Unprocessable Content (`application/problem+json`)",
      content: { "application/problem+json": { schema: ValidationProblemSchema } },
    },
    500: {
      description: "500 Internal Server Error (`application/problem+json`)",
      content: { "application/problem+json": { schema: InternalServerProblemSchema } },
    },
    503: {
      description: "503 Service Unavailable (`application/problem+json`)",
      content: { "application/problem+json": { schema: ServiceUnavailableProblemSchema } },
    },
  },
} as const);

export const postDrizzleRoute = createRoute({
  method: "post",
  path: "/drizzle",
  tags: ["drizzle"],
  description:
    "Run Drizzle code against the connected database. Code that does not parse, or a schema that\ndoes not, is a 422; an error the code throws is reported in the result with the statements\nthat ran before it.",
  operationId: "runQuery",
  request: {
    body: { content: { "application/json": { schema: QueryBodySchema } }, required: true },
  },
  responses: {
    200: {
      description: "The request has succeeded.",
      content: { "application/json": { schema: QueryResultSchema } },
    },
    422: {
      description: "422 Unprocessable Content (`application/problem+json`)",
      content: { "application/problem+json": { schema: ValidationProblemSchema } },
    },
    500: {
      description: "500 Internal Server Error (`application/problem+json`)",
      content: { "application/problem+json": { schema: InternalServerProblemSchema } },
    },
    503: {
      description: "503 Service Unavailable (`application/problem+json`)",
      content: { "application/problem+json": { schema: ServiceUnavailableProblemSchema } },
    },
  },
} as const);

export const postDrizzleTouchedRoute = createRoute({
  method: "post",
  path: "/drizzle/touched",
  tags: ["drizzle"],
  description:
    "The tables and columns Drizzle code touches, against the saved schema. Code or a schema that\ndoes not parse touches nothing.",
  operationId: "touchedByQuery",
  request: {
    body: { content: { "application/json": { schema: TouchedBodySchema } }, required: true },
  },
  responses: {
    200: {
      description: "The request has succeeded.",
      content: { "application/json": { schema: QueryTouchedSchema } },
    },
    422: {
      description: "422 Unprocessable Content (`application/problem+json`)",
      content: { "application/problem+json": { schema: ValidationProblemSchema } },
    },
    500: {
      description: "500 Internal Server Error (`application/problem+json`)",
      content: { "application/problem+json": { schema: InternalServerProblemSchema } },
    },
  },
} as const);
