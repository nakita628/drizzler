import { createFileRoute } from "@tanstack/react-router";

import { NotFound } from "../components/not-found.js";
import { EnumView } from "../features/data/enum-view.js";
import { useDocs } from "../hooks/index.js";

export const Route = createFileRoute("/enums/$name")({ component: EnumPage });

function EnumPage() {
  const { name } = Route.useParams();
  const docs = useDocs().data ?? null;
  if (docs === null) return <div className="p-6 text-muted">Loading…</div>;
  const value = docs.enums.find((e) => e.name === name);
  return value ? (
    <EnumView tables={docs.tables} value={value} />
  ) : (
    <NotFound what="enum" name={name} />
  );
}
