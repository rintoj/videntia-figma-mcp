import { mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RelayStatus } from "./relay-client.js";
import { expandHome } from "./utils.js";

export const DEFAULT_STATE_DIR = expandHome("~/.cache/videntia/drivers");

export interface DriverState {
  id: string;
  /** The driver process — what `stop` signals. */
  pid: number;
  chromePid: number | null;
  cdpUrl: string;
  relayUrl: string;
  relayStatus: RelayStatus;
  userDataDir: string | null;
  startedAt: number;
  lastCommandAt: number | null;
}

export function stateFilePath(id: string, dir = DEFAULT_STATE_DIR): string {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error(`Invalid driver id "${id}": use letters, digits, ".", "_" or "-"`);
  return join(dir, `${id}.json`);
}

export function writeDriverState(state: DriverState, dir = DEFAULT_STATE_DIR): void {
  mkdirSync(dir, { recursive: true });
  const path = stateFilePath(state.id, dir);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, path);
}

export function readDriverState(id: string, dir = DEFAULT_STATE_DIR): DriverState | null {
  try {
    return JSON.parse(readFileSync(stateFilePath(id, dir), "utf-8"));
  } catch {
    return null;
  }
}

/** Removes the state file only if it still belongs to `ownerPid`, so a newer driver's file survives. */
export function removeDriverState(id: string, ownerPid?: number, dir = DEFAULT_STATE_DIR): void {
  const current = readDriverState(id, dir);
  if (!current) return;
  if (ownerPid !== undefined && current.pid !== ownerPid) return;
  try {
    unlinkSync(stateFilePath(id, dir));
  } catch {}
}

export function isProcessAlive(pid: number | null | undefined): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e: any) {
    return e?.code === "EPERM";
  }
}

export function listDriverStates(dir = DEFAULT_STATE_DIR): Array<DriverState & { alive: boolean }> {
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out: Array<DriverState & { alive: boolean }> = [];
  for (const file of files) {
    const state = readDriverState(file.slice(0, -".json".length), dir);
    if (state) out.push({ ...state, alive: isProcessAlive(state.pid) });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}
