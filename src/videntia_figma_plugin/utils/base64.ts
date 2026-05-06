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
