// Helpers for copying node ids out of the Selection tab.
// Ids are only unique within a single Figma file, so a copied id is qualified
// with the joined channel when there is one.

export function formatCopiedIds(ids: string | string[], channelName?: string | null): string {
  var body = typeof ids === "string" ? ids : JSON.stringify(ids);
  var channel = channelName ? String(channelName).trim() : "";
  if (channel.length === 0) return body;
  return body + " (channel: '" + channel + "')";
}

export function isMacPlatform(): boolean {
  var nav: any = typeof navigator !== "undefined" ? navigator : null;
  if (!nav) return false;
  var probe = String(nav.platform || nav.userAgent || "");
  return /Mac|iPhone|iPad|iPod/i.test(probe);
}

export function copyShortcutLabel(isMac: boolean): string {
  return isMac ? "⌥⇧C" : "Alt+Shift+C";
}

// Option+Shift+C on macOS, Alt+Shift+C elsewhere. Cmd+Shift+C is reserved by
// Figma for "Copy as PNG" and is swallowed before the plugin iframe sees it.
// The letter is matched on e.code because holding Option rewrites e.key to an
// accented character ("ç" for Option+C), while e.code stays physical.
export function isCopyIdsChord(
  e: { code?: string; key: string; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean },
  _isMac: boolean,
): boolean {
  if (!e.shiftKey || !e.altKey) return false;
  if (e.metaKey || e.ctrlKey) return false;
  return String(e.code || "") === "KeyC";
}
