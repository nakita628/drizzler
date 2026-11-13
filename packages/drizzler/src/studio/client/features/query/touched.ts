import { useEffect, useRef, useState } from "react";
import { usePostDrizzleTouched } from "../../hooks/index.js";

const TOUCHED_DEBOUNCE_MS = 300;

export type TouchedTable = {
  readonly table: string;
  readonly columns: readonly string[];
  readonly write: boolean;
};

/**
 * The tables the code touches, read once typing pauses and again when the saved schema changes;
 * a stale answer is dropped, so a slow one never paints over what is typed now.
 */
export function useTouched(code: string, source: string | null) {
  const analyze = usePostDrizzleTouched();
  const [tables, setTables] = useState<readonly TouchedTable[]>([]);
  const seq = useRef(0);
  useEffect(() => {
    const current = ++seq.current;
    if (code.trim() === "") {
      setTables([]);
      return;
    }
    const timer = setTimeout(() => {
      analyze.mutate(
        { json: { code } },
        { onSuccess: (result) => current === seq.current && setTables(result.tables) },
      );
    }, TOUCHED_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [code, source]); // eslint-disable-line react-hooks/exhaustive-deps
  return { tables, analyze };
}
