import { Button } from "@heroui/react";
import { LuTerminal } from "react-icons/lu";
import { CopyButton } from "../../components/copy-button.js";

type Statement = {
  readonly sql: string;
  readonly params: readonly unknown[];
  readonly rowCount: number;
  readonly durationMs: number;
};

/**
 * The statements Drizzle sent for the query, in order, each with the values bound to its
 * placeholders, the rows it returned or changed and the time it took, and a way to take it to
 * the SQL page with those values written in.
 */
export function Statements({
  statements,
  dialect,
  onOpen,
}: {
  readonly statements: readonly Statement[];
  readonly dialect: "postgresql" | "mysql" | "sqlite" | null;
  readonly onOpen: (statement: Statement) => void;
}) {
  if (statements.length === 0) {
    return <div className="p-6 text-muted">The query sent no statement to the database.</div>;
  }
  return (
    <ol className="m-0 min-h-0 flex-1 list-none overflow-auto p-0">
      {statements.map((statement, index) => (
        // The statements carry no identity of their own; their order is what they are.
        // oxlint-disable-next-line react/no-array-index-key
        <li key={index} className="border-b border-line px-4 py-3">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-code text-muted">
            <span className="font-bold text-ink">#{index + 1}</span>
            <span>{statement.durationMs} ms</span>
            <span>
              {statement.rowCount.toLocaleString()} {statement.rowCount === 1 ? "row" : "rows"}
            </span>
            {statement.params.length > 0 ? (
              <span>
                {statement.params.length}{" "}
                {statement.params.length === 1 ? "parameter" : "parameters"}
              </span>
            ) : null}
            <span className="ml-auto flex items-center gap-1">
              <CopyButton text={statement.sql} what={`statement ${index + 1}`} />
              <Button
                variant="ghost"
                size="sm"
                onPress={() => {
                  onOpen(statement);
                }}
              >
                <LuTerminal size={14} />
                Open in SQL
              </Button>
            </span>
          </div>
          <pre className="m-0 font-mono text-code leading-relaxed break-all whitespace-pre-wrap text-ink">
            {statement.sql}
          </pre>
          {statement.params.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5 font-mono text-caption">
              {statement.params.map((value, position) => (
                <span
                  // The values are positional: the placeholder is their key.
                  // oxlint-disable-next-line react/no-array-index-key
                  key={position}
                  className="pill gap-1.5 border-line bg-canvas text-muted"
                >
                  <span className="text-ink">
                    {dialect === "postgresql" ? `$${position + 1}` : `?${position + 1}`}
                  </span>
                  <span className="max-w-[320px] truncate">{JSON.stringify(value)}</span>
                </span>
              ))}
            </div>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
