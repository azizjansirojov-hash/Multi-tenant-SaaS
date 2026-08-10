/** Minimum gap between float positions before renormalizing a list. */
export const MIN_POSITION_GAP = 1e-6;

/**
 * Compute a float position between two neighbors.
 * `null` means no neighbor on that side (prepend / append).
 */
export function positionBetween(
  before: number | null,
  after: number | null
): number {
  if (before == null && after == null) return 0;
  if (before == null) return after! - 1;
  if (after == null) return before + 1;
  return (before + after) / 2;
}

export function needsRenormalize(
  before: number | null,
  after: number | null,
  minGap: number = MIN_POSITION_GAP
): boolean {
  if (before == null || after == null) return false;
  return after - before < minGap;
}

/**
 * Assign sequential integer positions 0..n-1 preserving id order.
 */
export function renormalizePositions(
  ids: string[]
): { id: string; position: number }[] {
  return ids.map((id, index) => ({ id, position: index }));
}

export type Sibling = { id: string; position: number };

/**
 * Place `movedId` between beforeId and afterId among siblings.
 * Common case: returns a single new position for the moved item.
 * Fallback: returns full renormalized list when the float gap is too small.
 */
export function planMove(
  siblings: Sibling[],
  movedId: string,
  beforeId: string | null,
  afterId: string | null
):
  | { kind: "single"; position: number }
  | { kind: "renormalize"; updates: { id: string; position: number }[] } {
  const others = siblings.filter((s) => s.id !== movedId);

  const beforePos =
    beforeId == null
      ? null
      : (others.find((s) => s.id === beforeId)?.position ?? null);
  const afterPos =
    afterId == null
      ? null
      : (others.find((s) => s.id === afterId)?.position ?? null);

  if (needsRenormalize(beforePos, afterPos)) {
    let insertAt = others.length;
    if (afterId != null) {
      const idx = others.findIndex((s) => s.id === afterId);
      insertAt = idx < 0 ? others.length : idx;
    } else if (beforeId != null) {
      const idx = others.findIndex((s) => s.id === beforeId);
      insertAt = idx < 0 ? others.length : idx + 1;
    }
    const ids = others.map((s) => s.id);
    ids.splice(insertAt, 0, movedId);
    return { kind: "renormalize", updates: renormalizePositions(ids) };
  }

  return { kind: "single", position: positionBetween(beforePos, afterPos) };
}
