import { assertExpectedDocument } from "../../../src/videntia_figma_plugin/utils/document-guard";

const FILE_A = { fileKey: "keyA", rootId: "0:0", fileName: "Design System" };
const FILE_B = { fileKey: "keyB", rootId: "0:0", fileName: "Marketing Site" };

describe("assertExpectedDocument", () => {
  it("allows a command addressed to the document it reached", () => {
    expect(() => assertExpectedDocument("move_node", FILE_A, FILE_A)).not.toThrow();
  });

  it("refuses a command addressed to a different file, even when root ids collide", () => {
    // Root ids are "0:0" in every Figma file — fileKey must win when both sides have one.
    expect(() => assertExpectedDocument("delete_node", FILE_A, FILE_B)).toThrow(/Wrong Figma document/);
  });

  it("names BOTH files in the error so the mismatch is actionable", () => {
    let message = "";
    try {
      assertExpectedDocument("set_fill_color", FILE_A, FILE_B);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("Design System");
    expect(message).toContain("Marketing Site");
    expect(message).toContain("keyA");
    expect(message).toContain("keyB");
    expect(message).toContain("REFUSED");
  });

  it("falls back to root id for unsaved files with no fileKey", () => {
    const local1 = { fileKey: null, rootId: "0:1", fileName: "Untitled" };
    const local2 = { fileKey: null, rootId: "0:2", fileName: "Untitled" };
    expect(() => assertExpectedDocument("move_node", local1, local1)).not.toThrow();
    expect(() => assertExpectedDocument("move_node", local1, local2)).toThrow(/Wrong Figma document/);
  });

  it("does not gate the bootstrap commands that establish identity", () => {
    expect(() => assertExpectedDocument("get_file_key", FILE_A, FILE_B)).not.toThrow();
    expect(() => assertExpectedDocument("join", FILE_A, FILE_B)).not.toThrow();
  });

  it("stays out of the way when it cannot discriminate", () => {
    // No expectation sent (older MCP build), or no usable discriminator on either side.
    expect(() => assertExpectedDocument("move_node", undefined, FILE_A)).not.toThrow();
    expect(() => assertExpectedDocument("move_node", { fileName: "x" }, { fileName: "y" })).not.toThrow();
  });

  it("refuses when only one side has a fileKey but root ids differ", () => {
    expect(() =>
      assertExpectedDocument("move_node", { fileKey: "keyA", rootId: "0:1" }, { fileKey: null, rootId: "0:9" }),
    ).toThrow(/Wrong Figma document/);
  });
});
