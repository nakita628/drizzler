import { parseSync } from "oxc-parser";

/**
 * The schema without its leading imports, from the first line of code on. The
 * imports are found by parsing, so one written over several lines
 * (`import {\n  pgTable,\n} from ...`) goes whole; a source that does not
 * parse falls back to dropping the lines that start with `import`.
 */
export function stripImports(content: string) {
  const lines = content.split("\n");
  const { program, errors } = parseSync("schema.ts", content, { lang: "ts", sourceType: "module" });
  const firstCode = program.body.findIndex((stmt) => stmt.type !== "ImportDeclaration");
  const imports = program.body.slice(0, firstCode === -1 ? undefined : firstCode);
  const lastImportEnd = errors.length === 0 ? imports.at(-1)?.end : undefined;
  const firstLine =
    lastImportEnd === undefined ? 0 : content.slice(0, lastImportEnd).split("\n").length;
  const codeStart = lines.findIndex(
    (line, i) =>
      i >= firstLine &&
      line.trim() !== "" &&
      (lastImportEnd !== undefined || !line.trim().startsWith("import")),
  );
  return codeStart === -1 ? [] : lines.slice(codeStart);
}
