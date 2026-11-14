import { describe, expect, it } from "vite-plus/test";
import { saveStatus } from "./save-status.js";

describe("saveStatus", () => {
  it("shows a syntax error first, then saving, then unsaved changes, else saved", () => {
    const error = { message: "x", line: 3, column: 1 };
    expect(saveStatus({ parseError: error, saving: true, dirty: true })).toStrictEqual({
      label: "Line 3: syntax error",
      color: "danger",
    });
    expect(saveStatus({ parseError: null, saving: true, dirty: true }).label).toBe("Saving…");
    expect(saveStatus({ parseError: null, saving: false, dirty: true }).label).toBe("Unsaved");
    expect(saveStatus({ parseError: null, saving: false, dirty: false })).toStrictEqual({
      label: "Saved",
      color: "success",
    });
  });
});
