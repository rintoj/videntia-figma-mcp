// Bounded summaries of command params/results for the activity log.
// The log used to keep every full payload (exports, base64 images, node trees)
// for the life of the plugin, which grew to gigabytes over long agent sessions.

export var MAX_ACTIONS = 200;
var MAX_STRING = 1000;
var MAX_ARRAY = 50;
var MAX_KEYS = 50;
var MAX_DEPTH = 6;

function compactValue(value: any, depth: number): any {
  if (value === null || value === undefined) return value;
  var t = typeof value;
  if (t === "string") {
    if (value.length <= MAX_STRING) return value;
    return value.substring(0, MAX_STRING) + "... [" + value.length + " chars truncated]";
  }
  if (t !== "object") return value;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return "[binary " + (value as ArrayBuffer).byteLength + " bytes]";
  }
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? "[array(" + value.length + ")]" : "[object]";
  if (Array.isArray(value)) {
    var out: any[] = [];
    var n = Math.min(value.length, MAX_ARRAY);
    for (var i = 0; i < n; i++) out.push(compactValue(value[i], depth + 1));
    if (value.length > MAX_ARRAY) out.push("... [" + (value.length - MAX_ARRAY) + " more items]");
    return out;
  }
  var obj: Record<string, any> = {};
  var keys = Object.keys(value);
  var kn = Math.min(keys.length, MAX_KEYS);
  for (var k = 0; k < kn; k++) obj[keys[k]] = compactValue(value[keys[k]], depth + 1);
  if (keys.length > MAX_KEYS) obj["..."] = keys.length - MAX_KEYS + " more keys";
  return obj;
}

export function compactPayload(value: any): any {
  try {
    return compactValue(value, 0);
  } catch (e) {
    return "[unserializable]";
  }
}

/** Append to a ring buffer: keep only the newest `max` entries. */
export function appendCapped<T>(list: T[], entry: T, max: number): T[] {
  var next = list.length >= max ? list.slice(list.length - max + 1) : list.slice();
  next.push(entry);
  return next;
}
