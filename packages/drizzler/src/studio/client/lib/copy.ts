import { toast } from "@heroui/react";

/**
 * Writes text to the clipboard and says so. The clipboard gives no feedback of its own, and a
 * button that looks like it did nothing is a button people press twice — every copy in the studio
 * ends in a toast naming what was taken.
 */
export function copyText(text: string, what: string) {
  async function write() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${what} copied`);
    } catch {
      toast.danger(`${what} could not be copied — the browser refused the clipboard.`);
    }
  }
  void write();
}
