import { customBase64Encode, customBase64Decode } from "../../../src/videntia_figma_plugin/utils/base64";

describe("customBase64Decode", () => {
  it("round-trips through customBase64Encode", () => {
    const original = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3, 254, 255]);
    const encoded = customBase64Encode(original);
    const decoded = customBase64Decode(encoded);
    expect(Array.from(decoded)).toEqual(Array.from(original));
  });

  it("decodes a plain base64 string", () => {
    // "hello" in base64
    expect(Buffer.from(customBase64Decode("aGVsbG8=")).toString("utf8")).toBe("hello");
  });

  it("strips a data: URI prefix before decoding", () => {
    expect(Buffer.from(customBase64Decode("data:image/png;base64,aGVsbG8=")).toString("utf8")).toBe("hello");
  });

  it("ignores embedded whitespace/newlines", () => {
    expect(Buffer.from(customBase64Decode("aGVs\nbG8=")).toString("utf8")).toBe("hello");
  });

  it("returns an empty array for an empty string", () => {
    expect(customBase64Decode("").byteLength).toBe(0);
  });

  it("throws on invalid base64 characters", () => {
    expect(() => customBase64Decode("not-valid-base64!!")).toThrow();
  });

  it("throws on a length not a multiple of 4", () => {
    expect(() => customBase64Decode("abc")).toThrow();
  });

  it("handles single-byte padding", () => {
    // "hi" -> aGk=
    expect(Buffer.from(customBase64Decode("aGk=")).toString("utf8")).toBe("hi");
  });
});
