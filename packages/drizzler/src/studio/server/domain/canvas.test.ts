import { describe, expect, it } from "vite-plus/test";
import { makeCanvasSchema } from "./canvas.js";

const field = {
  name: "id",
  dbName: "id",
  kind: "scalar",
  type: "integer",
  isList: false,
  isRequired: true,
  isId: true,
  isForeignKey: false,
  documentation: null,
} as const;

describe("makeCanvasSchema", () => {
  it("keys each relation and gives each table the lines it is declared on", () => {
    const source = 'import x from "y";\n\nexport const user = t({\n  id: 1,\n});\n';
    const start = source.indexOf("export");
    const canvas = makeCanvasSchema({
      source,
      models: [
        { name: "user", dbName: "users", primaryKey: null, fields: [field] },
        { name: "post", dbName: "posts", primaryKey: null, fields: [field] },
      ],
      relations: [
        {
          origin: "inferred",
          onDelete: "cascade",
          from: { model: "user", field: "id", cardinality: "one" },
          to: { model: "post", field: "authorId", cardinality: "zero-many" },
        },
      ],
      enums: [],
      spans: [{ name: "user", start, end: source.indexOf("});") + 3 }],
    });
    expect(canvas.models.map((m) => [m.name, m.lines])).toStrictEqual([
      ["user", { start: 3, end: 5 }],
      // A table whose declaration was not found points at the top of the file.
      ["post", { start: 1, end: 1 }],
    ]);
    expect(canvas.models[0]?.fields[0]).toMatchObject({ isUnique: false, attributes: [] });
    expect(canvas.relations[0]).toMatchObject({
      id: "user.id->post.authorId",
      name: null,
      onUpdate: null,
    });
  });
});
