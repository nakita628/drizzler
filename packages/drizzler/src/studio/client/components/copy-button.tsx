import { Button } from "@heroui/react";
import { LuCopy } from "react-icons/lu";

import { copyText } from "../lib/copy.js";

/**
 * The one way anything in the studio is put on the clipboard: a cell, a row, a column name. `what`
 * is read out by the label and said back by the toast, so a copy is announced in the words of
 * the thing that was copied rather than as a bare "Copied".
 */
export function CopyButton({
  text,
  what,
  className = "",
  size = 13,
}: {
  readonly text: string;
  readonly what: string;
  readonly className?: string;
  readonly size?: number;
}) {
  return (
    <Button
      variant="ghost"
      size="sm"
      isIconOnly
      className={`text-faint hover:text-accent-text ${className}`}
      aria-label={`Copy ${what}`}
      onPress={() => {
        copyText(text, what);
      }}
    >
      <LuCopy size={size} />
    </Button>
  );
}
