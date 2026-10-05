import { readFileSync } from "fs";
import { join } from "path";
import { BROWSER_READONLY_COMMANDS, READONLY_COMMANDS } from "../../src/videntia_figma_mcp/utils/readonly-commands";

/**
 * The plugin's command lists are not tied together, and NOTHING fails at compile
 * time when one is missed:
 *
 * - a command dispatched by the plugin switch but absent from ALLOWED_COMMANDS is
 *   blocked at runtime with "Command not permitted" — the build is green and the
 *   TypeScript is correct;
 * - a read absent from READONLY_COMMANDS is blocked whenever readonly mode is on.
 *
 * These read the source lists directly (the same technique capabilities-manifest
 * uses) so every future command is covered, not just the ones added today.
 * READONLY_COMMANDS lives in a module shared with the server, so it is imported.
 */
const root = join(__dirname, "../../src/videntia_figma_plugin");
const pluginIndex = readFileSync(join(root, "index.ts"), "utf8");
const uiConstants = readFileSync(join(root, "ui/constants.ts"), "utf8");
const figmaCommandTypes = readFileSync(join(__dirname, "../../src/videntia_figma_mcp/types/index.ts"), "utf8");

/** Quoted string members of `const NAME = new Set([...])`. */
function setMembers(source: string, name: string): Set<string> {
  const match = source.match(new RegExp(`${name}\\s*=\\s*new Set(?:<[^>]*>)?\\(\\[([\\s\\S]*?)\\]\\)`));
  if (!match) throw new Error(`Could not locate ${name}`);
  return new Set(Array.from(match[1].matchAll(/"([a-z0-9_]+)"/g), (m) => m[1]));
}

/**
 * Every command the plugin's dispatch switch handles.
 *
 * Scoped to the body of `switch (command) { ... }` — the file has other switches
 * (over `msg["type"]`, a search filter, ...) whose `case` labels are not commands.
 */
function dispatchedCommands(): string[] {
  const start = pluginIndex.indexOf("switch (command) {");
  if (start === -1) throw new Error("Could not locate the command dispatch switch");

  // Walk braces to find the switch's closing brace.
  let depth = 0;
  let end = -1;
  for (let i = pluginIndex.indexOf("{", start); i < pluginIndex.length; i++) {
    if (pluginIndex[i] === "{") depth += 1;
    else if (pluginIndex[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) throw new Error("Unbalanced braces in the command dispatch switch");

  const body = pluginIndex.slice(start, end);
  return Array.from(body.matchAll(/^\s*case "([a-z0-9_]+)":/gm), (m) => m[1]);
}

const ALLOWED = setMembers(uiConstants, "ALLOWED_COMMANDS");
const READONLY = READONLY_COMMANDS;

describe("plugin command allowlist coverage", () => {
  it("parses non-trivial lists", () => {
    // Guards the parsing itself: an empty parse would make every assertion vacuous.
    expect(ALLOWED.size).toBeGreaterThan(100);
    expect(READONLY.size).toBeGreaterThan(20);
    expect(dispatchedCommands().length).toBeGreaterThan(100);
  });

  it("lists only commands the plugin dispatches as read-only", () => {
    // A typo here silently drops a read from readonly mode AND from the server's
    // retry-after-drop allowlist.
    const dispatched = new Set(dispatchedCommands());
    expect([...READONLY].filter((command) => !dispatched.has(command))).toEqual([]);
  });

  it("lists only real browser commands as read-only", () => {
    const union = figmaCommandTypes.match(/export type BrowserCommand =([\s\S]*?);/);
    if (!union) throw new Error("Could not locate the BrowserCommand union");
    const members = new Set(Array.from(union[1].matchAll(/"([a-z0-9_]+)"/g), (m) => m[1]));
    expect([...BROWSER_READONLY_COMMANDS].filter((command) => !members.has(command))).toEqual([]);
  });

  it("allows every command the plugin dispatches", () => {
    const missing = dispatchedCommands().filter((command) => !ALLOWED.has(command));
    // A command in this list compiles, dispatches, and is then refused at runtime.
    expect(missing).toEqual([]);
  });

  describe("commands added for Figma Motion + prototyping (#146)", () => {
    const writes = [
      "set_reactions",
      "apply_animation_style",
      "remove_animation_style",
      "set_keyframe_track",
      "remove_keyframe_track",
      "set_timeline_duration",
      "animate_node",
    ];
    const reads = ["get_motion_info", "list_animation_styles"];

    it.each([...writes, ...reads])("%s is in ALLOWED_COMMANDS", (command) => {
      expect(ALLOWED.has(command)).toBe(true);
    });

    it.each([...writes, ...reads])("%s is dispatched by the plugin", (command) => {
      expect(dispatchedCommands()).toContain(command);
    });

    it.each([...writes, ...reads])("%s is in the FigmaCommand union", (command) => {
      expect(figmaCommandTypes).toContain(`"${command}"`);
    });

    it.each(reads)("read %s is in READONLY_COMMANDS", (command) => {
      expect(READONLY.has(command)).toBe(true);
    });

    it.each(writes)("write %s is NOT in READONLY_COMMANDS", (command) => {
      // A write listed as read-only would bypass readonly mode and mutate the file.
      expect(READONLY.has(command)).toBe(false);
    });
  });
});
