import { createFileRoute } from "@tanstack/react-router";
import { QueryView } from "../features/query/query-view.js";

export const Route = createFileRoute("/query")({ component: QueryView });
