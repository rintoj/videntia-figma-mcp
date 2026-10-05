/**
 * Map `items` through async `fn` with at most `limit` calls in flight.
 * Results keep the input order. Rejects on the first rejection (like Promise.all).
 */
export async function boundedMap<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length));
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  const workers: Promise<void>[] = [];
  for (let w = 0; w < width; w++) workers.push(worker());
  await Promise.all(workers);
  return results;
}
