import { useEffect, useState } from "react";
import { usePostDiagramSchema, useSchema } from "../../hooks/index.js";
import type { CanvasSchema } from "./types.js";

/**
 * The saved file's diagram, drawn again when it changes on disk; while the file does not parse,
 * the last drawing that did is kept.
 */
export function useSavedDiagram() {
  const snapshot = useSchema().data ?? null;
  const draw = usePostDiagramSchema();
  const [schema, setSchema] = useState<CanvasSchema | null>(null);
  const source = snapshot?.source ?? null;
  useEffect(() => {
    if (source === null) return;
    draw.mutate(
      { json: { source } },
      { onSuccess: (result) => result.schema !== null && setSchema(result.schema) },
    );
  }, [source]); // eslint-disable-line react-hooks/exhaustive-deps
  return { snapshot, schema };
}
