import { captureUrl } from "../../../src/videntia_figma_mcp/utils/screenshot.js";

describe("captureUrl", () => {
  it("returns a PNG buffer for a valid URL", async () => {
    const result = await captureUrl({
      url: "data:text/html,<div style='width:100px;height:100px;background:red'></div>",
    });
    expect(result.screenshot).toBeInstanceOf(Buffer);
    expect(result.screenshot.length).toBeGreaterThan(0);
  }, 30000);

  it("crops to selector when provided", async () => {
    const result = await captureUrl({
      url: "data:text/html,<div id='box' style='width:50px;height:50px;background:blue'></div>",
      selector: "#box",
    });
    expect(result.screenshot).toBeInstanceOf(Buffer);
    expect(result.selector).toBe("#box");
  }, 30000);
});
