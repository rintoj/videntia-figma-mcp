// Shared plugin state accessible from handlers.
// Values are set by index.ts and read by handler modules.

var _autoFocus = false;

export function setAutoFocus(value: boolean): void {
  _autoFocus = value;
}

export function isAutoFocusEnabled(): boolean {
  return _autoFocus;
}

/**
 * Select and scroll to a node, but only when auto-focus is enabled.
 * Use this instead of directly setting `figma.currentPage.selection`.
 */
export function selectAndFocusNode(node: SceneNode): void {
  if (!_autoFocus) return;
  figma.currentPage.selection = [node];
  figma.viewport.scrollAndZoomIntoView([node]);
}
