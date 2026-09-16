/** Default distance (px) from the bottom that still counts as "at the bottom". */
export var SCROLL_THRESHOLD = 40;

/**
 * True when the scroll position is at (or within `threshold` px of) the bottom.
 * Used both to decide whether to stick to the bottom when new entries arrive
 * and to decide whether the scroll-to-latest affordance should be hidden.
 */
export function isAtBottom(scrollTop: number, scrollHeight: number, clientHeight: number, threshold?: number): boolean {
  var t = threshold === undefined ? SCROLL_THRESHOLD : threshold;
  return scrollHeight - scrollTop - clientHeight <= t;
}

/**
 * Whether the list should auto-scroll to the bottom after new content arrives.
 * Only sticks when the user was already parked at the bottom — never yanks a
 * user who has deliberately scrolled up.
 */
export function shouldStickToBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold?: number,
): boolean {
  return isAtBottom(scrollTop, scrollHeight, clientHeight, threshold);
}

/** The scroll-to-latest button is shown exactly when the user is not at the bottom. */
export function shouldShowScrollToBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
  threshold?: number,
): boolean {
  return !isAtBottom(scrollTop, scrollHeight, clientHeight, threshold);
}
