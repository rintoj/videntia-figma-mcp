// Figma MCP plugin.
//
// Figma's plugin sandbox does not expose the browser's `btoa` / `atob` in all
// contexts, so we use a pure-JS implementation that works on Uint8Array /
// ArrayBuffer-like objects returned by `node.exportAsync()`.

export function customBase64Encode(bytes: Uint8Array): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  const byteLength = bytes.byteLength;
  const byteRemainder = byteLength % 3;
  const mainLength = byteLength - byteRemainder;
  const outputLength = Math.ceil(byteLength / 3) * 4;
  const result = new Array<string>(outputLength);
  let outIdx = 0;

  for (let i = 0; i < mainLength; i += 3) {
    const chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
    result[outIdx++] = chars[(chunk & 16515072) >> 18];
    result[outIdx++] = chars[(chunk & 258048) >> 12];
    result[outIdx++] = chars[(chunk & 4032) >> 6];
    result[outIdx++] = chars[chunk & 63];
  }

  if (byteRemainder === 1) {
    const chunk = bytes[mainLength];
    result[outIdx++] = chars[(chunk & 252) >> 2];
    result[outIdx++] = chars[(chunk & 3) << 4];
    result[outIdx++] = "=";
    result[outIdx++] = "=";
  } else if (byteRemainder === 2) {
    const chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1];
    result[outIdx++] = chars[(chunk & 64512) >> 10];
    result[outIdx++] = chars[(chunk & 1008) >> 4];
    result[outIdx++] = chars[(chunk & 15) << 2];
    result[outIdx++] = "=";
  }

  return result.join("");
}

const DECODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const DECODE_LOOKUP = (() => {
  const table = new Int16Array(256).fill(-1);
  for (let i = 0; i < DECODE_CHARS.length; i++) {
    table[DECODE_CHARS.charCodeAt(i)] = i;
  }
  return table;
})();

/**
 * Decode a base64 string to bytes. Accepts an optional `data:...;base64,` prefix
 * (stripped before decoding) and ignores whitespace/newlines. Throws on any
 * character outside the base64 alphabet so callers get a clear error instead of
 * silently truncated/garbage image data.
 */
export function customBase64Decode(input: string): Uint8Array {
  const commaIndex = input.indexOf(",");
  const raw = input.startsWith("data:") && commaIndex !== -1 ? input.slice(commaIndex + 1) : input;
  const clean = raw.replace(/\s/g, "");

  if (clean.length === 0) return new Uint8Array(0);
  if (clean.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(clean)) {
    throw new Error("Invalid base64 string");
  }

  let padding = 0;
  if (clean.endsWith("==")) padding = 2;
  else if (clean.endsWith("=")) padding = 1;

  const outputLength = (clean.length / 4) * 3 - padding;
  const bytes = new Uint8Array(outputLength);
  let outIdx = 0;

  for (let i = 0; i < clean.length; i += 4) {
    const c0 = DECODE_LOOKUP[clean.charCodeAt(i)];
    const c1 = DECODE_LOOKUP[clean.charCodeAt(i + 1)];
    const c2Char = clean.charCodeAt(i + 2);
    const c3Char = clean.charCodeAt(i + 3);
    const c2 = clean[i + 2] === "=" ? 0 : DECODE_LOOKUP[c2Char];
    const c3 = clean[i + 3] === "=" ? 0 : DECODE_LOOKUP[c3Char];

    if (c0 < 0 || c1 < 0 || c2 < 0 || c3 < 0) {
      throw new Error("Invalid base64 string");
    }

    const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;

    if (outIdx < outputLength) bytes[outIdx++] = (triple >> 16) & 0xff;
    if (outIdx < outputLength) bytes[outIdx++] = (triple >> 8) & 0xff;
    if (outIdx < outputLength) bytes[outIdx++] = triple & 0xff;
  }

  return bytes;
}
