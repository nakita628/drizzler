import { Data } from "effect";

/** A request names a table the saved schema does not declare (`/db/rows/{tableName}`): a 404. */
export class UnknownTableError extends Data.TaggedError("UnknownTableError")<{
  readonly table: string;
}> {}

/** A request passed validation but its values cannot be used (no columns, no statement): a 422. */
export class InvalidInputError extends Data.TaggedError("InvalidInputError")<{
  readonly field: string;
  readonly message: string;
}> {}

/** The saved schema does not parse, so what depends on it (a diagram, a query) cannot be made. */
export class SchemaParseError extends Data.TaggedError("SchemaParseError")<{
  readonly message: string;
  readonly line: number;
  readonly column: number;
}> {}

/** A file the studio needs (the schema, a formatter config) cannot be read. */
export class FileReadError extends Data.TaggedError("FileReadError")<{
  readonly path: string;
  readonly cause: string;
}> {}

/** The schema file cannot be written back to disk. */
export class FileWriteError extends Data.TaggedError("FileWriteError")<{
  readonly path: string;
  readonly cause: string;
}> {}

/** oxfmt cannot format the source, or the project's oxfmt config is not valid JSON: a 422. */
export class FormatError extends Data.TaggedError("FormatError")<{
  readonly message: string;
}> {}

/** The ER diagram cannot be drawn as SVG or PNG. */
export class RenderError extends Data.TaggedError("RenderError")<{
  readonly message: string;
}> {}

/** No database is connected, or its driver cannot be loaded or opened: a 503. */
export class DatabaseUnavailableError extends Data.TaggedError("DatabaseUnavailableError")<{
  readonly reason: string;
}> {}

/** The connected database rejected a statement, with the driver's message. */
export class DatabaseError extends Data.TaggedError("DatabaseError")<{
  readonly cause: string;
}> {}

/** The studio's server cannot listen on its port (`EADDRINUSE` when another process holds it). */
export class ServerListenError extends Data.TaggedError("ServerListenError")<{
  readonly port: number;
  readonly code: string | null;
  readonly message: string;
}> {}

/** The project's `typescript` cannot be loaded, so the editor has no completion or type errors: a 503. */
export class LanguageUnavailableError extends Data.TaggedError("LanguageUnavailableError")<{
  readonly reason: string;
}> {}

/** A query that does not parse, with where in its own text. */
export class QueryError extends Data.TaggedError("QueryError")<{
  readonly message: string;
  readonly line: number;
  readonly column: number;
}> {}

/** A query that parsed failed while it ran: its module did not load, it threw, or it timed out. */
export class QueryRunError extends Data.TaggedError("QueryRunError")<{
  readonly message: string;
}> {}

/** The built client is not where the studio serves it from. */
export class MissingAssetsError extends Data.TaggedError("MissingAssetsError")<{
  readonly dir: string;
}> {}
