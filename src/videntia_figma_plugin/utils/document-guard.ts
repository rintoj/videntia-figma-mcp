/**
 * Guard against cross-document writes.
 *
 * Figma node ids are unique only WITHIN a file — "3082:47270" resolves to a
 * different node in every open document. An MCP session that joined the wrong
 * channel and then wrote to a node id remembered from another file therefore
 * used to silently mutate an unrelated document, with no error anywhere.
 *
 * The MCP client stamps every command with the identity of the file it believes
 * it is addressing (captured at join_channel). This refuses the command when
 * that identity is not this document.
 */

export interface DocumentIdentity {
  fileKey?: string | null;
  rootId?: string | null;
  fileName?: string | null;
}

/** Commands that must never be gated: they are how identity is bootstrapped. */
const UNGATED_COMMANDS = ["join", "get_file_key"];

function describe(identity: DocumentIdentity): string {
  const name = identity.fileName || "unknown file";
  const discriminator = identity.fileKey ? `fileKey ${identity.fileKey}` : `root ${identity.rootId || "unknown"}`;
  return `"${name}" (${discriminator})`;
}

/**
 * @throws when `expected` names a different document than `actual`.
 * No-ops when the caller sent no expectation, or when neither side exposes a
 * usable discriminator (an older plugin/client build) — the guard must never
 * block a session it cannot actually reason about.
 */
export function assertExpectedDocument(
  command: string,
  expected: DocumentIdentity | undefined | null,
  actual: DocumentIdentity,
): void {
  if (UNGATED_COMMANDS.indexOf(command) !== -1) return;
  if (!expected || typeof expected !== "object") return;

  // Prefer fileKey (Figma's canonical per-file id, stable across sessions); fall
  // back to the root node id for unsaved/local files that have no fileKey.
  let matches: boolean;
  if (expected.fileKey && actual.fileKey) {
    matches = expected.fileKey === actual.fileKey;
  } else if (expected.rootId && actual.rootId) {
    matches = expected.rootId === actual.rootId;
  } else {
    return;
  }
  if (matches) return;

  throw new Error(
    "Wrong Figma document: this command was addressed to " +
      describe(expected) +
      " but the plugin receiving it is attached to " +
      describe(actual) +
      ". Node IDs are not unique across files, so the command was REFUSED rather than applied to the wrong " +
      "document. Run get_open_channels and join_channel for the intended file.",
  );
}
