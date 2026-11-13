import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";
import { SchemaView } from "../features/schema/schema-view.js";

export const Route = createFileRoute("/")({
  validateSearch: z.object({
    focus: z
      .string()
      .optional()
      .meta({ description: "The table to fit the diagram to", example: "user" }),
  }),
  component: SchemaPage,
});

function SchemaPage() {
  const { focus } = Route.useSearch();
  return <SchemaView focus={focus ?? null} />;
}
