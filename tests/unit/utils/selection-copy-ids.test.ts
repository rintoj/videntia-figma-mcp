import {
  copiedIdsToast,
  copyShortcutLabel,
  formatCopiedIds,
  isCopyIdsChord,
  quickActionsShortcutLabel,
  repeatPluginShortcutLabel,
} from "../../../src/videntia_figma_plugin/shared/copy-ids";

function chord(over: Partial<Record<string, any>> = {}) {
  return Object.assign(
    { code: "KeyC", key: "c", shiftKey: true, metaKey: false, ctrlKey: false, altKey: false },
    over,
  ) as {
    code: string;
    key: string;
    shiftKey: boolean;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
  };
}

describe("selection copy-ids helpers", () => {
  describe("formatCopiedIds", () => {
    it("appends the channel to a single id", () => {
      expect(formatCopiedIds("3082:47270", "abc123")).toBe("3082:47270 (channel: 'abc123')");
    });

    it("appends the channel once to a JSON array", () => {
      expect(formatCopiedIds(["3082:47270", "3082:47271"], "abc123")).toBe(
        '["3082:47270","3082:47271"] (channel: \'abc123\')',
      );
    });

    it("returns the bare id when no channel is joined", () => {
      expect(formatCopiedIds("3082:47270")).toBe("3082:47270");
      expect(formatCopiedIds("3082:47270", "")).toBe("3082:47270");
      expect(formatCopiedIds("3082:47270", null)).toBe("3082:47270");
      expect(formatCopiedIds("3082:47270", undefined)).toBe("3082:47270");
      expect(formatCopiedIds("3082:47270", "   ")).toBe("3082:47270");
    });

    it("returns the bare JSON array when no channel is joined", () => {
      expect(formatCopiedIds(["a", "b"], "")).toBe('["a","b"]');
    });

    it("keeps an empty array valid", () => {
      expect(formatCopiedIds([], "abc123")).toBe("[] (channel: 'abc123')");
    });
  });

  describe("copiedIdsToast", () => {
    it("singularises one id and pluralises the rest", () => {
      expect(copiedIdsToast(1)).toBe("Copied 1 node ID");
      expect(copiedIdsToast(2)).toBe("Copied 2 node IDs");
      expect(copiedIdsToast(0)).toBe("Copied 0 node IDs");
    });

    it("stays inside the 100 character figma.notify cap", () => {
      expect(copiedIdsToast(999999).length).toBeLessThanOrEqual(100);
    });
  });

  describe("global command shortcut labels", () => {
    it("renders the platform symbols for Quick Actions and run-last-plugin", () => {
      expect(quickActionsShortcutLabel(true)).toBe("⌘K");
      expect(quickActionsShortcutLabel(false)).toBe("Ctrl+K");
      expect(repeatPluginShortcutLabel(true)).toBe("⌥⌘P");
      expect(repeatPluginShortcutLabel(false)).toBe("Ctrl+Alt+P");
    });
  });

  describe("copyShortcutLabel", () => {
    it("renders the platform symbols", () => {
      expect(copyShortcutLabel(true)).toBe("⌥⇧C");
      expect(copyShortcutLabel(false)).toBe("Alt+Shift+C");
    });
  });

  describe("isCopyIdsChord", () => {
    it("matches Option+Shift+C on macOS", () => {
      expect(isCopyIdsChord(chord({ altKey: true }), true)).toBe(true);
    });

    it("matches Alt+Shift+C off macOS", () => {
      expect(isCopyIdsChord(chord({ altKey: true }), false)).toBe(true);
    });

    it("matches when Option rewrites the key to an accented character", () => {
      expect(isCopyIdsChord(chord({ altKey: true, key: "ç" }), true)).toBe(true);
    });

    it("does not match Cmd+Shift+C or Ctrl+Shift+C, which Figma reserves", () => {
      expect(isCopyIdsChord(chord({ metaKey: true }), true)).toBe(false);
      expect(isCopyIdsChord(chord({ ctrlKey: true }), false)).toBe(false);
      expect(isCopyIdsChord(chord({ altKey: true, metaKey: true }), true)).toBe(false);
      expect(isCopyIdsChord(chord({ altKey: true, ctrlKey: true }), false)).toBe(false);
    });

    it("rejects a missing shift, a missing alt, or a wrong physical key", () => {
      expect(isCopyIdsChord(chord({ altKey: true, shiftKey: false }), true)).toBe(false);
      expect(isCopyIdsChord(chord({ altKey: false }), true)).toBe(false);
      expect(isCopyIdsChord(chord({ altKey: true, code: "KeyV" }), true)).toBe(false);
      expect(isCopyIdsChord(chord({ altKey: true, code: undefined }), true)).toBe(false);
    });
  });
});
