import { z } from "zod";
import { coerceArray } from "../../../src/claude_figma_mcp/utils/coerce-array";

describe("coerceArray", () => {
  const stringArraySchema = coerceArray(z.array(z.string()));

  it("should pass through arrays unchanged", () => {
    const result = stringArraySchema.parse(["a", "b", "c"]);
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("should parse JSON string arrays", () => {
    const result = stringArraySchema.parse('["a","b"]');
    expect(result).toEqual(["a", "b"]);
  });

  it("should split comma-separated strings", () => {
    const result = stringArraySchema.parse("a,b,c");
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("should wrap single string values in an array", () => {
    const result = stringArraySchema.parse("a");
    expect(result).toEqual(["a"]);
  });

  it("should parse JSON object arrays", () => {
    const objectArraySchema = coerceArray(z.array(z.object({ key: z.string() })));
    const result = objectArraySchema.parse('[{"key":"val"}]');
    expect(result).toEqual([{ key: "val" }]);
  });

  it("should return non-string/non-array values unchanged (lets Zod handle the error)", () => {
    expect(() => stringArraySchema.parse(123)).toThrow();
    expect(() => stringArraySchema.parse(null)).toThrow();
    expect(() => stringArraySchema.parse(undefined)).toThrow();
  });

  it("should handle whitespace in comma-separated strings", () => {
    const result = stringArraySchema.parse(" a , b , c ");
    expect(result).toEqual(["a", "b", "c"]);
  });

  it("should handle empty string", () => {
    // Empty string after trimming has length 0, so val passes through unchanged
    expect(() => stringArraySchema.parse("")).toThrow();
  });

  it("should filter out empty segments from comma-separated strings", () => {
    const result = stringArraySchema.parse("a,,b");
    expect(result).toEqual(["a", "b"]);
  });

  it("should handle JSON arrays with whitespace", () => {
    const result = stringArraySchema.parse(' ["x", "y"] ');
    expect(result).toEqual(["x", "y"]);
  });

  it("should fall through on invalid JSON starting with [", () => {
    // Invalid JSON but starts with [, falls through to comma split
    const result = stringArraySchema.parse("[not-json,stuff");
    expect(result).toEqual(["[not-json", "stuff"]);
  });

  it("should work with z.enum arrays", () => {
    const enumArraySchema = coerceArray(z.array(z.enum(["FRAME", "COMPONENT", "TEXT"])));
    const result = enumArraySchema.parse("FRAME,COMPONENT");
    expect(result).toEqual(["FRAME", "COMPONENT"]);
  });

  it("should work with optional().describe() chaining", () => {
    const schema = z.object({
      items: coerceArray(z.array(z.string())).optional().describe("test field"),
    });

    expect(schema.parse({ items: "a,b" })).toEqual({ items: ["a", "b"] });
    expect(schema.parse({})).toEqual({});
  });
});
