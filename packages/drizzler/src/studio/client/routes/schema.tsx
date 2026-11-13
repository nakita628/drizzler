import { createFileRoute } from "@tanstack/react-router";
import * as z from "zod";
import { DrizzleView } from "../features/editor/drizzle-view.js";

export const Route = createFileRoute("/schema")({
  validateSearch: z.object({
    focus: z
      .string()
      .optional()
      .meta({ description: "The table to put the cursor on", example: "user" }),
    line: z
      .number()
      .optional()
      .meta({ description: "The 1-based line to put the cursor on", example: 12 }),
  }),
  component: DrizzlePage,
});

function DrizzlePage() {
  const { focus, line } = Route.useSearch();
  return <DrizzleView focus={focus ?? null} line={line ?? null} />;
}
