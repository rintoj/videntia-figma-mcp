import { describe, expect, it } from "@jest/globals";
import {
  addRequestWarning,
  appendWarningsToResponse,
  getRequestWarnings,
  runWithChannel,
} from "../../../src/videntia_figma_mcp/utils/channel-context";
import { applyQueueWarning } from "../../../src/videntia_figma_mcp/utils/websocket";

describe("queue-wait warning surfaces for every result shape", () => {
  it("appends a text block without touching the payload", () => {
    const res = { content: [{ type: "text", text: "[1,2]" }] };
    const out = appendWarningsToResponse(res, ["slow"]);
    expect(out.content).toHaveLength(2);
    expect(out.content[1]).toEqual({ type: "text", text: "Warning: slow" });
    expect(out.content[0]).toBe(res.content[0]);
    expect(appendWarningsToResponse(res, [])).toBe(res);
    expect(appendWarningsToResponse("x" as unknown, ["w"])).toBe("x");
  });

  it.each([[[1, 2]], ["text"], [42], [{ a: 1 }]])("records the warning for result %p", async (result) => {
    await runWithChannel(undefined, undefined, async () => {
      expect(applyQueueWarning(result, 9000)).toBe(result);
      expect(getRequestWarnings()[0]).toContain("Waited 9.0s");
    });
  });

  it("nested scopes share the outer warning list", async () => {
    await runWithChannel(undefined, undefined, async () => {
      await runWithChannel("inner", undefined, async () => addRequestWarning("inner warn"));
      expect(getRequestWarnings()).toEqual(["inner warn"]);
    });
  });

  it("is a no-op outside a request scope", () => {
    expect(applyQueueWarning([1], 9000)).toEqual([1]);
    expect(getRequestWarnings()).toEqual([]);
  });
});

describe("server cancel frame", () => {
  it("addresses the plugin with the original request id", async () => {
    const { buildCancelFrame } = await import("../../../src/videntia_figma_mcp/utils/websocket");
    expect(buildCancelFrame("ch", "abc")).toEqual({
      id: "cancel-abc",
      type: "message",
      channel: "ch",
      message: { type: "cancel", id: "abc" },
    });
  });
});
