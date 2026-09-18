import {
  SCROLL_THRESHOLD,
  isAtBottom,
  shouldStickToBottom,
  shouldShowScrollToBottom,
} from "../../../src/videntia_figma_plugin/ui/scroll-utils";

describe("plugin UI scroll-utils", () => {
  describe("isAtBottom", () => {
    it("is true when exactly at the bottom", () => {
      expect(isAtBottom(600, 1000, 400)).toBe(true);
    });

    it("is true within the default threshold", () => {
      expect(isAtBottom(570, 1000, 400)).toBe(true); // 30px from bottom
      expect(isAtBottom(560, 1000, 400)).toBe(true); // exactly 40px
    });

    it("is false beyond the threshold", () => {
      expect(isAtBottom(559, 1000, 400)).toBe(false); // 41px
      expect(isAtBottom(0, 1000, 400)).toBe(false);
    });

    it("is true when content does not overflow", () => {
      expect(isAtBottom(0, 300, 400)).toBe(true);
    });

    it("honours a custom threshold", () => {
      expect(isAtBottom(559, 1000, 400, 100)).toBe(true);
      expect(isAtBottom(559, 1000, 400, 0)).toBe(false);
    });

    it("defaults the threshold to SCROLL_THRESHOLD", () => {
      expect(isAtBottom(1000 - 400 - SCROLL_THRESHOLD, 1000, 400)).toBe(true);
      expect(isAtBottom(1000 - 400 - SCROLL_THRESHOLD - 1, 1000, 400)).toBe(false);
    });
  });

  describe("shouldStickToBottom", () => {
    it("sticks when the user was parked at the bottom", () => {
      expect(shouldStickToBottom(600, 1000, 400)).toBe(true);
    });

    it("stays put when the user scrolled up deliberately", () => {
      expect(shouldStickToBottom(100, 1000, 400)).toBe(false);
    });
  });

  describe("shouldShowScrollToBottom", () => {
    it("is hidden at the bottom", () => {
      expect(shouldShowScrollToBottom(600, 1000, 400)).toBe(false);
    });

    it("is shown once scrolled up past the threshold", () => {
      expect(shouldShowScrollToBottom(100, 1000, 400)).toBe(true);
    });

    it("is the inverse of shouldStickToBottom", () => {
      const cases: Array<[number, number, number]> = [
        [600, 1000, 400],
        [100, 1000, 400],
        [0, 300, 400],
        [559, 1000, 400],
      ];
      for (const [top, height, client] of cases) {
        expect(shouldShowScrollToBottom(top, height, client)).toBe(!shouldStickToBottom(top, height, client));
      }
    });
  });
});
