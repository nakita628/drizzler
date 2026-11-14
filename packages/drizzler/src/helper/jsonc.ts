/**
 * JSON with comments (tsconfig.json, .oxfmtrc.jsonc) as JSON: its \`//\` and \`/* *\/\` comments and
 * trailing commas removed, strings left as they are. The caller parses it, since JSON.parse throws.
 */
export function stripJsonc(text: string) {
  // A string (kept, even one left open), a line comment, or a block comment (to the end of the
  // text when it is never closed), read left to right so a \`//\` inside a string stays.
  const stripped = text.replace(
    /("(?:[^"\\]|\\[\s\S])*(?:"|\\?$))|\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$)/gu,
    (_match, string: string | undefined) => string ?? "",
  );
  // A trailing comma is legal in JSONC and not in JSON.
  return stripped.replace(/,(\s*[}\]])/gu, "$1");
}
