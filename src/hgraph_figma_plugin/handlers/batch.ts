// Batch actions handler — executes multiple commands in a single round-trip.
// handleCommand is injected to avoid a circular module dependency.

import { sendProgressUpdate } from '../utils/helpers';
import type { BatchAction, BatchActionResult } from '../types';

// Max depth for field path navigation to prevent abuse.
// NOTE: This logic is mirrored in src/hgraph_figma_mcp/utils/resolve-result-references.ts
// which has comprehensive unit tests. Keep both implementations in sync.
const RESOLVE_MAX_PATH_DEPTH = 10;

export type HandleCommandFn = (
  command: string,
  params: Record<string, unknown>,
) => Promise<unknown>;

// Resolves $result[N].field references in action params against previous results.
function resolveResultReferences(
  params: unknown,
  results: BatchActionResult[],
): unknown {
  if (params === null || params === undefined) return params;

  if (typeof params === 'string') {
    const refMatch = params.match(/^\$result\[(\d+)\](.*)$/);
    if (refMatch) {
      const refIndex = parseInt(refMatch[1], 10);
      const fieldPath = refMatch[2]; // e.g., ".id" or ".children[0].name"

      if (refIndex >= results.length) {
        throw new Error(
          '$result[' +
            refIndex +
            '] references action that has not executed yet (only ' +
            results.length +
            ' completed)',
        );
      }

      const referencedResult = results[refIndex];
      if (!referencedResult.success) {
        throw new Error(
          '$result[' +
            refIndex +
            '] references a failed action: ' +
            (referencedResult.error !== undefined
              ? referencedResult.error
              : 'unknown error'),
        );
      }

      let value: unknown = referencedResult.result;

      if (fieldPath) {
        const segments = fieldPath.match(/\.([a-zA-Z_]\w*)|(\[\d+\])/g);
        if (segments) {
          if (segments.length > RESOLVE_MAX_PATH_DEPTH) {
            throw new Error(
              'Field path exceeds maximum depth of ' +
                RESOLVE_MAX_PATH_DEPTH +
                ': $result[' +
                refIndex +
                ']' +
                fieldPath,
            );
          }
          for (let s = 0; s < segments.length; s++) {
            const segment = segments[s];
            if (value === null || value === undefined) {
              throw new Error(
                "Cannot access '" +
                  segment +
                  "' on null/undefined in $result[" +
                  refIndex +
                  ']' +
                  fieldPath,
              );
            }
            if (segment.startsWith('[')) {
              const arrIndex = parseInt(segment.slice(1, -1), 10);
              value = (value as unknown[])[arrIndex];
            } else {
              // Remove leading dot
              value = (value as Record<string, unknown>)[segment.slice(1)];
            }
          }
        }
      }

      return value;
    }
    return params;
  }

  if (Array.isArray(params)) {
    return params.map(function (item: unknown) {
      return resolveResultReferences(item, results);
    });
  }

  if (typeof params === 'object') {
    const resolved: Record<string, unknown> = {};
    const keys = Object.keys(params as object);
    for (let k = 0; k < keys.length; k++) {
      resolved[keys[k]] = resolveResultReferences(
        (params as Record<string, unknown>)[keys[k]],
        results,
      );
    }
    return resolved;
  }

  return params;
}

export async function batchActions(
  params: Record<string, unknown>,
  handleCommand: HandleCommandFn,
): Promise<Record<string, unknown>> {
  const rawActions = params !== null && params !== undefined ? params['actions'] : undefined;
  const stopOnError =
    params !== null && params !== undefined && params['stopOnError'] !== undefined
      ? (params['stopOnError'] as boolean)
      : false;

  if (!Array.isArray(rawActions) || rawActions.length === 0) {
    throw new Error("batch_actions requires a non-empty 'actions' array");
  }

  const actions = rawActions as BatchAction[];
  const results: BatchActionResult[] = [];
  let succeeded = 0;
  let failed = 0;
  const commandId =
    params !== null && params !== undefined && params['commandId'] !== undefined
      ? String(params['commandId'])
      : 'batch';
  const totalActions = actions.length;
  const shouldSendProgress = totalActions > 1;
  // Emit ~10 progress updates regardless of batch size (at least 1 per action for small batches)
  const progressInterval = Math.max(1, Math.floor(totalActions / 10));

  for (let i = 0; i < totalActions; i++) {
    const { action, params: actionParams } = actions[i];

    // Block recursive batch_actions calls
    if (action === 'batch_actions') {
      results.push({
        index: i,
        action,
        success: false,
        error: 'Recursive batch_actions calls are not allowed',
      });
      failed++;
      if (stopOnError) break;
      continue;
    }

    try {
      // Resolve $result[N].field references
      const resolvedParams = resolveResultReferences(
        actionParams !== null && actionParams !== undefined ? actionParams : {},
        results,
      ) as Record<string, unknown>;

      const result = await handleCommand(action, resolvedParams);
      results.push({ index: i, action, success: true, result });
      succeeded++;
    } catch (error) {
      results.push({
        index: i,
        action,
        success: false,
        error:
          error instanceof Error ? error.message : String(error),
      });
      failed++;

      // Send immediate progress update on failure for large batches
      if (shouldSendProgress) {
        const progress = Math.round(((i + 1) / totalActions) * 100);
        sendProgressUpdate(
          commandId,
          'batch_actions',
          'in_progress',
          progress,
          totalActions,
          i + 1,
          `Action ${i + 1} (${action}) failed. Processed ${i + 1}/${totalActions} (${succeeded} succeeded, ${failed} failed)`,
        );
      }

      if (stopOnError) break;
    }

    // Send progress updates — once per action for small batches, every N for large batches
    if (shouldSendProgress && (i + 1) % progressInterval === 0) {
      const progress = Math.round(((i + 1) / totalActions) * 100);
      sendProgressUpdate(
        commandId,
        'batch_actions',
        'in_progress',
        progress,
        totalActions,
        i + 1,
        `Processed ${i + 1}/${totalActions} actions (${succeeded} succeeded, ${failed} failed)`,
      );
    }
  }

  return {
    success: failed === 0,
    totalActions,
    succeeded,
    failed,
    results,
  };
}
