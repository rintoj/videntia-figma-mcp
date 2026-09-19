import {
  DEFAULT_SOCKET_HOST,
  DEFAULT_SOCKET_PORT,
  socketUrlFrom,
} from "../../../src/videntia_figma_plugin/shared/socket-url";

describe("socketUrlFrom", () => {
  it("falls back to the panel's localhost default", () => {
    expect(socketUrlFrom({})).toBe("ws://" + DEFAULT_SOCKET_HOST + ":" + DEFAULT_SOCKET_PORT);
    expect(socketUrlFrom({})).toBe("ws://localhost:3055");
  });

  it("honours a custom port on localhost", () => {
    expect(socketUrlFrom({ serverPort: 4000 })).toBe("ws://localhost:4000");
    expect(socketUrlFrom({ serverPort: 4000, serverUrl: "127.0.0.1" })).toBe("ws://localhost:4000");
  });

  it("keeps localhost on ws even when the secure preference is set", () => {
    expect(socketUrlFrom({ serverUrl: "localhost", serverSecure: true })).toBe("ws://localhost:3055");
  });

  it("uses the secure preference for a remote host and drops the port", () => {
    expect(socketUrlFrom({ serverUrl: "figma-mcp.videntia.dev", serverSecure: true })).toBe(
      "wss://figma-mcp.videntia.dev",
    );
    expect(socketUrlFrom({ serverUrl: "figma-mcp.videntia.dev" })).toBe("ws://figma-mcp.videntia.dev");
  });

  it("treats blank or invalid settings as unset", () => {
    expect(socketUrlFrom({ serverUrl: "   ", serverPort: 0 })).toBe("ws://localhost:3055");
    expect(socketUrlFrom({ serverUrl: null, serverPort: null, serverSecure: null })).toBe("ws://localhost:3055");
  });
});
