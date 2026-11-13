import { Link } from "@tanstack/react-router";
import { LuExternalLink } from "react-icons/lu";

/**
 * The way from a card to its page: a table's, or an enum's. One click on
 * something you can see; `nodrag`/`nopan` keep React Flow from reading the press as a drag.
 */
export function OpenNodeLink({
  kind,
  name,
}: {
  readonly kind: "table" | "enum";
  readonly name: string;
}) {
  const props = {
    title: `Open ${name}`,
    "aria-label": `Open ${name}`,
    className: "nodrag nopan inline-flex shrink-0 opacity-60 hover:opacity-100",
    onClick: (event: React.MouseEvent) => event.stopPropagation(),
  };
  return kind === "table" ? (
    <Link to="/tables/$name" params={{ name }} search={{}} {...props}>
      <LuExternalLink size={13} />
    </Link>
  ) : (
    <Link to="/enums/$name" params={{ name }} {...props}>
      <LuExternalLink size={13} />
    </Link>
  );
}
