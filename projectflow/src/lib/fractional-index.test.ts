import { describe, expect, it } from "vitest";
import {
  MIN_POSITION_GAP,
  needsRenormalize,
  planMove,
  positionBetween,
  renormalizePositions,
} from "@/lib/fractional-index";

describe("fractional-index", () => {
  it("positionBetween returns 0 when both sides empty", () => {
    expect(positionBetween(null, null)).toBe(0);
  });

  it("positionBetween prepends before first", () => {
    expect(positionBetween(null, 0)).toBe(-1);
  });

  it("positionBetween appends after last", () => {
    expect(positionBetween(2, null)).toBe(3);
  });

  it("positionBetween midpoints neighbors", () => {
    expect(positionBetween(0, 1)).toBe(0.5);
    expect(positionBetween(1, 3)).toBe(2);
  });

  it("needsRenormalize when gap is too small", () => {
    expect(needsRenormalize(0, MIN_POSITION_GAP / 2)).toBe(true);
    expect(needsRenormalize(0, 1)).toBe(false);
    expect(needsRenormalize(null, 1)).toBe(false);
  });

  it("renormalizePositions assigns sequential ints", () => {
    expect(renormalizePositions(["a", "b", "c"])).toEqual([
      { id: "a", position: 0 },
      { id: "b", position: 1 },
      { id: "c", position: 2 },
    ]);
  });

  it("planMove uses midpoint in the common case", () => {
    const result = planMove(
      [
        { id: "a", position: 0 },
        { id: "b", position: 1 },
        { id: "c", position: 2 },
      ],
      "b",
      "a",
      "c"
    );
    expect(result).toEqual({ kind: "single", position: 1 });
  });

  it("planMove falls back to renormalize when gap collapses", () => {
    const tiny = MIN_POSITION_GAP / 10;
    const result = planMove(
      [
        { id: "a", position: 0 },
        { id: "b", position: tiny },
        { id: "x", position: 5 },
      ],
      "x",
      "a",
      "b"
    );
    expect(result.kind).toBe("renormalize");
    if (result.kind === "renormalize") {
      expect(result.updates).toEqual([
        { id: "a", position: 0 },
        { id: "x", position: 1 },
        { id: "b", position: 2 },
      ]);
    }
  });
});
