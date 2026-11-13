// Documentation rules: every exported function and class says what it is for, the studio's layers
// document their inputs and outputs, and the request flow and the I/O are drawn as mermaid
// diagrams. People and AI read the TSDoc before the body.
//
//   require-tsdoc             every exported function / class carries TSDoc (studio layers also
//                             document each parameter, the return value and, in domain, an example)
//   require-sequence-diagram  studio handlers and usecases draw their flow as a mermaid sequenceDiagram
//   require-diagram           studio services draw what they do as a mermaid diagram

import {
  INDEX_FILE,
  TEST_FILE,
  exportedDeclarations,
  getFilename,
  layerOf,
  leadingTsdoc,
} from "./helpers.js";

// What each studio layer's TSDoc has to say besides a summary.
const LAYER_TAGS = {
  handlers: { params: false, returns: false, example: false },
  usecases: { params: true, returns: true, example: false },
  services: { params: true, returns: true, example: false },
  domain: { params: true, returns: true, example: true },
};

// The `@param` names a function's parameters need: `name` for a plain parameter, and
// `name.field` for each field of an object type written inline (`input: { readonly sql: string }`).
function paramNames(fn) {
  return fn.params.flatMap((param) => {
    const target = param.type === "AssignmentPattern" ? param.left : param;
    if (target.type !== "Identifier") return [];
    const type = target.typeAnnotation?.typeAnnotation;
    if (type?.type === "TSTypeLiteral") {
      return type.members
        .filter((m) => m.type === "TSPropertySignature" && m.key.type === "Identifier")
        .map((m) => `${target.name}.${m.key.name}`);
    }
    return [target.name];
  });
}

function hasParam(doc, name) {
  const escaped = name.replace(/[.$]/gu, (ch) => `\\${ch}`);
  return new RegExp(`@param\\s+${escaped}(?![\\w.$])`, "u").test(doc);
}

function returnsSomething(fn) {
  if (fn === null) return true;
  if (fn.type === "ArrowFunctionExpression" && fn.expression) return true;
  const annotated = fn.returnType?.typeAnnotation?.type;
  if (annotated === "TSVoidKeyword" || annotated === "TSNeverKeyword") return false;
  return true;
}

export const docRules = {
  // Why: an exported function or class is used by people who did not write it. A TSDoc comment
  //      right above it says what it is for, before anyone reads the body. In the studio's layers
  //      it also says what goes in and comes out:
  //        usecases / services : `@param` for each parameter (each field of an inline `input`
  //                              object: `@param input.sql`) and `@returns`
  //        domain              : the same plus `@example` (pure functions can show input → output)
  //   NG: export function outputKind(output: string) { … }                 // no TSDoc
  //   OK: /** What an output path asks for, by its extension. *\/
  //       export function outputKind(output: string) { … }
  "require-tsdoc": {
    meta: { docs: { description: "exported functions and classes must carry TSDoc" } },
    create(context) {
      const filename = getFilename(context);
      if (TEST_FILE.test(filename)) return {};
      const layer = layerOf(filename);
      const tags = (layer && !INDEX_FILE.test(filename) && LAYER_TAGS[layer]) || null;
      return {
        ExportNamedDeclaration(node) {
          for (const { name, kind, fn, node: target } of exportedDeclarations(node)) {
            const doc = leadingTsdoc(context, target);
            if (doc === null) {
              context.report({
                node: target,
                message: `\`${name}\` is exported, so it needs a TSDoc comment (/** … */) right above it saying what it ${kind === "class" ? "represents" : "does"}${tags?.params ? ", with `@param` for each parameter and `@returns`" : ""}. People and AI read the TSDoc before they read the body.`,
              });
              continue;
            }
            if (tags === null || kind !== "function") continue;
            const missing = [
              ...(tags.params && fn !== null
                ? paramNames(fn)
                    .filter((p) => !hasParam(doc, p))
                    .map((p) => `\`@param ${p}\``)
                : []),
              ...(tags.returns && returnsSomething(fn) && !/@returns\b/u.test(doc)
                ? ["`@returns`"]
                : []),
              ...(tags.example && !/@example\b/u.test(doc) ? ["`@example`"] : []),
            ];
            if (missing.length === 0) continue;
            context.report({
              node: target,
              message: `The TSDoc of \`${name}\` is missing ${missing.join(", ")}. In ${layer}, document every parameter (each field of an inline \`input\` object as \`@param input.field - …\`) and what comes back (\`@returns …\`)${tags.example ? ", plus an input → output `@example`" : ""}.`,
            });
          }
        },
      };
    },
  },

  // Why: one request is easier to review as a picture than as code: who calls whom, in what
  //      order, and where it branches on failure.
  //   NG: /** Deletes rows. *\/ export const deleteRowsRouteHandler: RouteHandler<…> = …
  //   OK: /**
  //        * Deletes rows.
  //        * ```mermaid
  //        * sequenceDiagram
  //        *   participant H as Handler
  //        *   participant U as DbUseCase
  //        *   H->>U: deleteRow({ table, where })
  //        * ```
  //        *\/
  // Turned on for studio handlers and usecases in the config. Barrels and tests are exempt.
  "require-sequence-diagram": {
    meta: {
      docs: {
        description: "handlers and usecases include a mermaid sequenceDiagram in their TSDoc",
      },
    },
    create(context) {
      const filename = getFilename(context);
      if (TEST_FILE.test(filename) || INDEX_FILE.test(filename)) return {};
      return {
        ExportNamedDeclaration(node) {
          for (const { name, kind, node: target } of exportedDeclarations(node)) {
            if (kind !== "function") continue;
            const doc = leadingTsdoc(context, target) ?? "";
            if (doc.includes("```mermaid") && doc.includes("sequenceDiagram")) continue;
            context.report({
              node: target,
              message: `Add a mermaid sequence diagram to the TSDoc of \`${name}\` (\`\`\`mermaid / sequenceDiagram): who calls whom, in what order, and where it branches on failure.`,
            });
          }
        },
      };
    },
  },

  // Why: a service is where the studio touches the outside world (files, the database, the
  //      TypeScript service, oxfmt). A diagram shows what goes in, what it touches and what comes
  //      out before anyone reads the I/O code.
  //   NG: /** Reads the schema file. *\/ export function readText(file: string) { … }
  //   OK: /**
  //        * Reads the schema file.
  //        * ```mermaid
  //        * flowchart LR
  //        *   path --> fs[(file system)] --> text
  //        * ```
  //        *\/
  // Turned on for studio services in the config. Barrels and tests are exempt.
  "require-diagram": {
    meta: { docs: { description: "services include a mermaid diagram in their TSDoc" } },
    create(context) {
      const filename = getFilename(context);
      if (TEST_FILE.test(filename) || INDEX_FILE.test(filename)) return {};
      return {
        ExportNamedDeclaration(node) {
          for (const { name, kind, node: target } of exportedDeclarations(node)) {
            if (kind !== "function") continue;
            const doc = leadingTsdoc(context, target) ?? "";
            if (doc.includes("```mermaid")) continue;
            context.report({
              node: target,
              message: `Add a mermaid diagram to the TSDoc of \`${name}\` (\`\`\`mermaid, e.g. flowchart): what goes in, what it touches (files, the database, a library), and what comes out.`,
            });
          }
        },
      };
    },
  },
};
