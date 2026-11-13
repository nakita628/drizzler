import path from "node:path";
import { Config, Console, Effect, Option } from "effect";
import { Argument, CliError, Command, Flag } from "effect/cli";
import { version } from "../../package.json" with { type: "json" };
import { drizzlerDbml, drizzlerDocs, drizzlerER, drizzlerMermaidER } from "../core/index.js";
import { collectSchemaFiles, drizzleConfigSchema, readSchemaSources } from "../schema/sources.js";
import { DEFAULT_PORT } from "../studio/server/constants/index.js";
import type {
  FileReadError,
  MissingAssetsError,
  ServerListenError,
} from "../studio/server/errors/index.js";

const COMMAND_NAME = "drizzler";

/**
 * What an output path asks for, by its extension: a directory (a trailing `/`, or no extension)
 * is the docs; null for a file drizzler does not write.
 */
export function outputKind(output: string) {
  if (output.endsWith("/") || path.extname(output) === "") return "docs" as const;
  if (output.endsWith(".dbml")) return "dbml" as const;
  if (output.endsWith(".png") || output.endsWith(".svg")) return "diagram" as const;
  if (output.endsWith(".md")) return "mermaid" as const;
  return null;
}

const generateFlags = {
  input: Argument.String("input").pipe(
    Argument.withDescription(
      "The Drizzle schema: files, directories or globs (default: the schema of drizzle.config.ts)",
    ),
    Argument.variadic(),
  ),
  output: Flag.String("output").pipe(
    Flag.withAlias("o"),
    Flag.withDescription("Output file (.md, .dbml, .svg, .png), or a directory for the docs"),
    Flag.withMetavar("path"),
    Flag.optional,
  ),
  theme: Flag.Literals("theme", ["light", "dark"]).pipe(
    Flag.withDescription("Colour scheme of the .svg / .png ER diagram"),
    Flag.withDefault("light"),
  ),
} as const;

type GenerateArgs = Command.Command.Config.Infer<typeof generateFlags>;

function userError(cause: string) {
  return new CliError.UserError({ cause });
}

/**
 * The schema's text, every file it is made of without its imports, or a UserError naming the
 * input: the files, directories and globs given, and the project modules they import.
 */
function readSchema(inputs: readonly string[], cwd: string) {
  return Effect.gen(function* () {
    const files = yield* collectSchemaFiles(inputs, cwd);
    return { files, code: yield* readSchemaSources(files) };
  }).pipe(Effect.mapError((error) => userError(`Failed to read input: ${error.message}`)));
}

/** The inputs given, else the `schema` of drizzle.config.ts in `cwd`; empty when neither is. */
function schemaInputs(given: readonly string[], cwd: string) {
  if (given.length > 0) return Effect.succeed(given);
  return drizzleConfigSchema(cwd).pipe(
    Effect.map((config) => config?.inputs ?? []),
    Effect.mapError((error) => userError(`Failed to read drizzle.config: ${error.message}`)),
  );
}

/**
 * Writes the schema as the kind of output the path asks for: the files it wrote, and what it left
 * out and why (the docs' SQL, when the schema could not be loaded).
 */
function writeOutput(
  kind: NonNullable<ReturnType<typeof outputKind>>,
  schema: { readonly files: readonly string[]; readonly code: string[] },
  output: string,
  theme: "light" | "dark",
) {
  const { code } = schema;
  // One Effect whatever the kind, so its failures are mapped once.
  return Effect.gen(function* () {
    switch (kind) {
      case "dbml":
        yield* drizzlerDbml(code, output);
        return { written: [output], notes: [] };
      case "diagram":
        yield* drizzlerER(code, output, theme);
        return { written: [output], notes: [] };
      case "mermaid":
        yield* drizzlerMermaidER(code, output);
        return { written: [output], notes: [] };
      case "docs":
        return yield* drizzlerDocs(code, output, theme, schema.files);
    }
  });
}

/** What the line printed after writing calls the output; for the docs, the files it holds. */
function describeOutput(
  kind: NonNullable<ReturnType<typeof outputKind>>,
  output: string,
  written: readonly string[],
) {
  switch (kind) {
    case "dbml":
      return "DBML";
    case "mermaid":
      return "Mermaid ER";
    case "diagram":
      return `${output.endsWith(".png") ? "PNG" : "SVG"} ER diagram`;
    case "docs": {
      const names = written.map((file) => path.relative(output, file));
      const top = names.filter((name) => !name.includes(path.sep));
      const tables = names.length > top.length ? ["tables/*.svg"] : [];
      return `docs (${[...top, ...tables].join(", ")})`;
    }
  }
}

/** Reads the schema and writes what the output path asks for; the line it prints names it. */
export function generate(args: GenerateArgs) {
  return Effect.gen(function* () {
    const cwd = process.cwd();
    const inputs = yield* schemaInputs(args.input, cwd);
    // Without a schema there is nothing to do: the usage is the answer.
    if (inputs.length === 0) {
      return yield* new CliError.ShowHelp({ commandPath: [COMMAND_NAME], errors: [] });
    }
    if (Option.isNone(args.output)) {
      return yield* userError("Missing -o flag. Usage: drizzler <input...> -o <output>");
    }
    const output = args.output.value;
    const kind = outputKind(output);
    if (kind === null) {
      return yield* userError(
        `Unsupported output format: ${output}. Supported: .dbml, .svg, .png, .md, or a directory for the docs`,
      );
    }
    const schema = yield* readSchema(inputs, cwd);
    const { written, notes } = yield* writeOutput(kind, schema, output, args.theme).pipe(
      Effect.mapError((error) => userError(`Failed to write ${output}: ${error.message}`)),
    );
    yield* Console.log(`💧 Generated ${describeOutput(kind, output, written)} at: ${output}`);
    yield* Effect.forEach(notes, (note) => Console.error(`   ${note}`));
  });
}

const studioFlags = {
  input: Argument.String("input").pipe(Argument.withDescription("The Drizzle schema file to edit")),
  port: Flag.Int("port").pipe(
    Flag.withAlias("p"),
    Flag.withDescription(`Port to listen on (default: ${DEFAULT_PORT})`),
    Flag.withMetavar("port"),
    Flag.filter(
      (port) => port >= 1 && port <= 65_535,
      () => "a port from 1 to 65535",
    ),
    Flag.withDefault(DEFAULT_PORT),
  ),
  url: Flag.String("url").pipe(
    Flag.withAlias("u"),
    Flag.withDescription("Database to browse, edit and query (default: $DATABASE_URL)"),
    Flag.withMetavar("database-url"),
    Flag.withFallbackConfig(Config.String("DATABASE_URL")),
    Flag.optional,
  ),
} as const;

/** What the terminal says when the studio cannot start. */
function studioFailure(error: FileReadError | MissingAssetsError | ServerListenError) {
  switch (error._tag) {
    case "FileReadError":
      return `Failed to read input: ${error.path} ${error.cause}`;
    case "MissingAssetsError":
      return `drizzler studio assets were not found in ${error.dir}.\nReinstall drizzler, or run "pnpm build" when working from the repository.`;
    case "ServerListenError":
      if (error.code === "EADDRINUSE") {
        return `Port ${error.port} is in use. Pass --port to pick another.`;
      }
      return `Failed to start studio: ${error.message}`;
  }
}

// The server pulls in Hono, the drivers and the language service, which `--help`, `--version`
// and a rejected command line must not pay for, so it is imported when it runs.
function studio() {
  return Command.make("studio", studioFlags, (args) =>
    Effect.gen(function* () {
      const { runStudio } = yield* Effect.promise(() => import("../studio/index.js"));
      return yield* runStudio({
        file: args.input,
        port: args.port,
        url: Option.getOrNull(args.url),
      }).pipe(Effect.mapError((error) => userError(studioFailure(error))));
    }),
  ).pipe(Command.withDescription("Edit the schema, its ER diagram, docs and data"));
}

const seedFlags = {
  config: Flag.String("config").pipe(
    Flag.withAlias("c"),
    Flag.withDescription("The seed config (default: drizzler.config.ts)"),
    Flag.withMetavar("path"),
    Flag.optional,
  ),
  url: Flag.String("url").pipe(
    Flag.withAlias("u"),
    Flag.withDescription("Database to insert into (default: the config's url, then $DATABASE_URL)"),
    Flag.withMetavar("database-url"),
    Flag.optional,
  ),
  sql: Flag.String("sql").pipe(
    Flag.withDescription("Write the rows as a SQL script instead of inserting them"),
    Flag.withMetavar("seed.sql"),
    Flag.optional,
  ),
  seed: Flag.Int("seed").pipe(
    Flag.withDescription(
      "The faker seed; the same seed always gives the same rows (left out: every run differs)",
    ),
    Flag.withMetavar("n"),
    Flag.optional,
  ),
  count: Flag.Int("count").pipe(
    Flag.withDescription(
      "Rows for every faker model, over the per-model counts of the config; models given as data keep their rows",
    ),
    Flag.withMetavar("n"),
    Flag.filter(
      (count) => count >= 0,
      () => "a count of 0 or more",
    ),
    Flag.optional,
  ),
  locale: Flag.String("locale").pipe(
    Flag.withDescription("The faker locale, or several tried in order (ja,en)"),
    Flag.withMetavar("locale"),
    Flag.optional,
  ),
  reset: Flag.Boolean("reset").pipe(
    Flag.withDescription("Delete every row of the seeded tables before inserting"),
    Flag.withDefault(false),
  ),
} as const;

// The seeder pulls in faker with every locale, drizzle-orm and the database drivers, which
// `--help`, `--version` and a rejected command line must not pay for.
function seed() {
  return Command.make("seed", seedFlags, (args) =>
    Effect.gen(function* () {
      const { runSeed, seedBanner } = yield* Effect.promise(() => import("../seed/run.js"));
      const report = yield* runSeed(
        {
          config: Option.getOrNull(args.config),
          url: Option.getOrNull(args.url),
          output: Option.getOrNull(args.sql),
          seed: Option.getOrNull(args.seed),
          count: Option.getOrNull(args.count),
          locale: Option.getOrNull(args.locale),
          reset: args.reset,
        },
        process.cwd(),
      ).pipe(Effect.mapError((error) => userError(error.message)));
      yield* Console.log(seedBanner(report));
    }),
  ).pipe(
    Command.withDescription("Fill the database with rows made from drizzler.config.ts"),
    Command.withExamples([
      { command: `${COMMAND_NAME} seed`, description: "Insert the rows the config describes" },
      {
        command: `${COMMAND_NAME} seed --sql seed.sql`,
        description: "Write them as a SQL script instead",
      },
      {
        command: `${COMMAND_NAME} seed --reset --seed 7 --count 100`,
        description: "Empty the seeded tables first, then insert 100 rows per model from seed 7",
      },
      { command: `${COMMAND_NAME} seed --locale ja`, description: "Japanese names and addresses" },
    ]),
  );
}

function cli() {
  return Command.make(COMMAND_NAME, generateFlags, generate).pipe(
    Command.withDescription("💧 Drizzle ORM schema tools"),
    Command.withSubcommands([studio(), seed()]),
  );
}

/** The `drizzler` command line, run with the arguments the `Stdio` service supplies. */
export function drizzler() {
  return Command.run(cli(), { version });
}
