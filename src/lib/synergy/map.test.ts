import { describe, expect, it } from "vitest";
import {
  buildMapElements,
  packPieCloud,
  type MapCard,
  type MapTop,
  type PackInput,
  type PackPosition,
} from "./map";

function rect(p: { x: number; y: number; w: number; h: number }) {
  return {
    left: p.x - p.w / 2,
    right: p.x + p.w / 2,
    top: p.y - p.h / 2,
    bottom: p.y + p.h / 2,
  };
}

function overlap(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): boolean {
  const ra = rect(a);
  const rb = rect(b);
  return ra.right > rb.left && ra.left < rb.right && ra.bottom > rb.top && ra.top < rb.bottom;
}

function input(id: string, tier: PackInput["tier"], size = 60, shareCount = 1): PackInput {
  return { id, tier, width: size, height: Math.round(size * 0.75), shareCount };
}

describe("packPieCloud", () => {
  it("empty input → empty output", () => {
    expect(packPieCloud([])).toEqual([]);
  });

  it("never overlaps any pair of nodes (99 mixed-tier cards)", () => {
    const nodes: PackInput[] = [];
    let id = 0;
    for (const tier of ["gold", "silver", "bronze", "none"] as const) {
      const count = tier === "gold" ? 35 : tier === "silver" ? 18 : tier === "bronze" ? 16 : 30;
      const size = tier === "gold" ? 120 : tier === "silver" ? 70 : tier === "bronze" ? 50 : 30;
      for (let i = 0; i < count; i++) nodes.push(input(`n${id++}`, tier, size));
    }
    const positions = packPieCloud(nodes);
    expect(positions).toHaveLength(99);
    const placed = positions.map((p) => {
      const n = nodes.find((x) => x.id === p.id)!;
      return { x: p.x, y: p.y, w: n.width, h: n.height };
    });
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(overlap(placed[i], placed[j])).toBe(false);
      }
    }
  });

  it("places every input card exactly once", () => {
    const nodes: PackInput[] = [
      input("g1", "gold", 100),
      input("g2", "gold", 100),
      input("s1", "silver", 70),
      input("b1", "bronze", 50),
      input("n1", "none", 30),
    ];
    const positions = packPieCloud(nodes);
    expect(positions.map((p) => p.id).sort()).toEqual(["b1", "g1", "g2", "n1", "s1"]);
  });

  it("sector arc width scales with card count", () => {
    // 6 gold, 2 silver, 2 bronze, 0 none → gold is 60% of the circle.
    const nodes: PackInput[] = [
      ...Array.from({ length: 6 }, (_, i) => input(`g${i}`, "gold", 100)),
      ...Array.from({ length: 2 }, (_, i) => input(`s${i}`, "silver", 70)),
      ...Array.from({ length: 2 }, (_, i) => input(`b${i}`, "bronze", 50)),
    ];
    const positions = packPieCloud(nodes);
    const goldPositions = positions.filter((p) => p.id.startsWith("g"));
    const silverPositions = positions.filter((p) => p.id.startsWith("s"));
    // Gold cards should span a wider angular range than silver.
    const angle = (p: PackPosition) => Math.atan2(p.y, p.x);
    const goldRange = Math.max(...goldPositions.map(angle)) - Math.min(...goldPositions.map(angle));
    const silverRange =
      Math.max(...silverPositions.map(angle)) - Math.min(...silverPositions.map(angle));
    expect(goldRange).toBeGreaterThan(silverRange);
  });

  it("planetary layout places anchors + moons without overlap", () => {
    // 5 highly-connected gold cards (anchors) + 30 moons with varying
    // keyword overlap with the anchors.
    const anchorKws = [["a", "b"], ["a", "c"], ["b", "c"], ["a", "d"], ["b", "d"]];
    const anchors = anchorKws.map<PackInput>((kw, i) => ({
      id: `anchor-${i}`,
      tier: "gold",
      shareCount: 3,
      width: 120,
      height: 90,
      keywords: kw,
    }));
    const moons: PackInput[] = [];
    for (let i = 0; i < 30; i++) {
      moons.push({
        id: `moon-${i}`,
        tier: i < 10 ? "silver" : i < 20 ? "bronze" : "none",
        shareCount: 1,
        width: 70,
        height: 53,
        keywords: [anchorKws[i % 5][0]],
      });
    }
    // packPlanetary is exported on the same module
    return import("./map").then(({ packPlanetary }) => {
      const positions = packPlanetary([...anchors, ...moons]);
      expect(positions).toHaveLength(35);
      const byId = new Map(positions.map((p) => [p.id, p]));
      const placedRects = [...anchors, ...moons].map((n) => {
        const p = byId.get(n.id)!;
        return { x: p.x, y: p.y, w: n.width, h: n.height };
      });
      for (let i = 0; i < placedRects.length; i++) {
        for (let j = i + 1; j < placedRects.length; j++) {
          expect(overlap(placedRects[i], placedRects[j])).toBe(false);
        }
      }
    });
  });

  it("higher-shareCount cards sit on the innermost ring of their sector", () => {
    // Several gold cards with mixed share counts. The one with shareCount=3
    // should be the closest to the origin.
    const nodes: PackInput[] = [
      input("g-big", "gold", 130, 3),
      input("g-mid1", "gold", 110, 2),
      input("g-mid2", "gold", 110, 2),
      input("g-small1", "gold", 90, 1),
      input("g-small2", "gold", 90, 1),
    ];
    const positions = packPieCloud(nodes);
    const r = (id: string) => {
      const p = positions.find((x) => x.id === id)!;
      return Math.sqrt(p.x ** 2 + p.y ** 2);
    };
    expect(r("g-big")).toBeLessThanOrEqual(r("g-small1"));
    expect(r("g-big")).toBeLessThanOrEqual(r("g-small2"));
  });
});

describe("buildMapElements (smoke)", () => {
  it("classifies the top-keyword card as gold", () => {
    const cards: MapCard[] = [
      { id: "a", name: "A", keywords: ["land", "forest"] },
      { id: "b", name: "B", keywords: ["instant"] },
    ];
    const top: MapTop = { primary: "land", secondary: "instant", tertiary: undefined };
    const { nodes, edges } = buildMapElements(cards, top, { includeTier4: false });
    expect(nodes.find((n) => n.id === "a")?.tier).toBe("gold");
    expect(nodes.find((n) => n.id === "b")?.tier).toBe("silver");
    expect(edges).toHaveLength(0); // they share nothing in top-3
  });
});
