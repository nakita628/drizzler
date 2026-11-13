import { createFileRoute } from "@tanstack/react-router";
import { DocsView } from "../features/docs/docs-view.js";

export const Route = createFileRoute("/docs")({ component: DocsView });
