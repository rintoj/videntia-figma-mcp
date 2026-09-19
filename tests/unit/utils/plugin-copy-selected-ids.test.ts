import { COPY_SELECTED_IDS_COMMAND, lastChannelStorageKey } from "../../../src/videntia_figma_plugin/copy-selected-ids";

describe("copy-selected-ids menu command", () => {
  it("uses the command string declared in the plugin manifest menu", () => {
    expect(COPY_SELECTED_IDS_COMMAND).toBe("copy-selected-ids");
  });

  it("scopes the stored channel to the file, so ids are never qualified with another file's channel", () => {
    expect(lastChannelStorageKey("HomeVault Design")).toBe("last-channel:HomeVault Design");
    expect(lastChannelStorageKey("HomeVault Design")).not.toBe(lastChannelStorageKey("Marketing Site"));
  });
});
