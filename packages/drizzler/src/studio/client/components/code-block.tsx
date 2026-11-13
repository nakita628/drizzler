import { javascript } from "@codemirror/lang-javascript";
import { classHighlighter, highlightCode } from "@lezer/highlight";

const PARSER = javascript({ typescript: true }).language.parser;

type Token = { readonly at: number; readonly text: string; readonly className: string };

// The tokens CodeMirror hands back one by one, each with the offset it starts at. highlightCode
// reports through callbacks, so they are gathered in a box, as a ref would hold them.
function highlighted(code: string): readonly Token[] {
  const box: { current: readonly Token[] } = { current: [] };
  function put(text: string, className: string) {
    const last = box.current.at(-1);
    const at = last === undefined ? 0 : last.at + last.text.length;
    box.current = [...box.current, { at, text, className }];
  }
  highlightCode(code, PARSER.parse(code), classHighlighter, put, () => {
    put("\n", "");
  });
  return box.current;
}

/** A TypeScript snippet with syntax highlighting, tokenised by CodeMirror's parser. */
export function CodeBlock({
  code,
  className = "",
}: {
  readonly code: string;
  readonly className?: string;
}) {
  const tokens = highlighted(code);
  return (
    <pre className={`m-0 overflow-auto font-mono text-code leading-relaxed text-ink ${className}`}>
      <code>
        {tokens.map((token) =>
          token.className === "" ? (
            token.text
          ) : (
            <span key={token.at} className={token.className}>
              {token.text}
            </span>
          ),
        )}
      </code>
    </pre>
  );
}
