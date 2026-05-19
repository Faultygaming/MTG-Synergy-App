import { describe, it, expect } from "vitest";
import {
  stepPhysics,
  DEFAULT_PARAMS,
  type PhysicsNode,
  type Velocity,
  type Vec2,
} from "./synergyLivePhysics";

function nodes(...defs: Array<[string, number, number, boolean?]>): PhysicsNode[] {
  return defs.map(([id, x, y, grabbed]) => ({ id, x, y, grabbed: !!grabbed }));
}

function anchors(...defs: Array<[string, number, number]>): Map<string, Vec2> {
  return new Map(defs.map(([id, x, y]) => [id, { x, y }]));
}

describe("stepPhysics", () => {
  it("at rest with no displacement, idle nodes don't accelerate appreciably", () => {
    // All nodes at their anchors, no grab, all far apart. KE should be ~0.
    const n = nodes(
      ["card:a", 0, 0],
      ["card:b", 1000, 0],
      ["card:c", 0, 1000],
    );
    const a = anchors(
      ["card:a", 0, 0],
      ["card:b", 1000, 0],
      ["card:c", 0, 1000],
    );
    const velocities = new Map<string, Velocity>();
    const { totalKE } = stepPhysics(n, a, velocities, DEFAULT_PARAMS);
    // Cards out of repulsion range and at anchor → near-zero forces.
    expect(totalKE).toBeLessThan(0.1);
  });

  it("a grabbed node pushes nearby neighbors away from it", () => {
    // Grabbed card at (0,0); a neighbor at (80,0) should be pushed to
    // the right (positive x) by repulsion.
    const n = nodes(
      ["card:grabbed", 0, 0, true],
      ["card:neighbor", 80, 0],
    );
    const a = anchors(
      ["card:grabbed", 500, 500],
      ["card:neighbor", 80, 0],
    );
    const velocities = new Map<string, Velocity>();
    const { newPositions } = stepPhysics(n, a, velocities, DEFAULT_PARAMS);

    const neighbor = newPositions.get("card:neighbor");
    expect(neighbor).toBeDefined();
    expect(neighbor!.x).toBeGreaterThan(80);
    // The grabbed node itself isn't in newPositions — cytoscape owns
    // its position during drag.
    expect(newPositions.has("card:grabbed")).toBe(false);
  });

  it("snaps a displaced node back toward its anchor over multiple steps", () => {
    // Card at (200, 0), anchor at (0, 0). No grab anywhere. Iterate
    // and watch the x-coordinate decay toward zero.
    let current = { x: 200, y: 0 };
    const a = anchors(["card:a", 0, 0]);
    const velocities = new Map<string, Velocity>();

    let prev = current.x;
    for (let i = 0; i < 200; i++) {
      const n: PhysicsNode[] = [
        { id: "card:a", x: current.x, y: current.y, grabbed: false },
      ];
      const { newPositions } = stepPhysics(n, a, velocities, DEFAULT_PARAMS);
      current = newPositions.get("card:a")!;
      // Within the first ~10 frames the spring should be pulling
      // monotonically inward (no other forces).
      if (i < 10) {
        expect(current.x).toBeLessThan(prev);
      }
      prev = current.x;
    }
    // After 200 frames, the spring has converged near the anchor.
    expect(Math.abs(current.x)).toBeLessThan(10);
  });

  it("reports anyGrabbed=true while any node is grabbed", () => {
    const n = nodes(["card:a", 0, 0, true], ["card:b", 100, 0]);
    const a = anchors(["card:a", 0, 0], ["card:b", 100, 0]);
    const { anyGrabbed } = stepPhysics(
      n,
      a,
      new Map(),
      DEFAULT_PARAMS,
    );
    expect(anyGrabbed).toBe(true);
  });

  it("filters by repulseRange — distant pairs don't push each other", () => {
    // Two nodes 700 apart, default range is 600. No repulsion expected.
    const n = nodes(["card:a", 0, 0, true], ["card:b", 700, 0]);
    const a = anchors(["card:a", 0, 0], ["card:b", 700, 0]);
    const { newPositions } = stepPhysics(
      n,
      a,
      new Map(),
      DEFAULT_PARAMS,
    );
    const b = newPositions.get("card:b")!;
    // At anchor + out of range → no movement.
    expect(b.x).toBeCloseTo(700, 1);
    expect(b.y).toBeCloseTo(0, 1);
  });

  it("hard caps a card's distance from its anchor at maxDisplacement", () => {
    // Place a card WAY off its anchor; one step of physics should not
    // allow it to remain beyond maxDisplacement.
    const max = DEFAULT_PARAMS.maxDisplacement;
    const n: PhysicsNode[] = [
      { id: "card:a", x: 1000, y: 0, grabbed: false },
    ];
    const a = anchors(["card:a", 0, 0]);
    const { newPositions } = stepPhysics(n, a, new Map(), DEFAULT_PARAMS);
    const p = newPositions.get("card:a")!;
    const d = Math.sqrt(p.x * p.x + p.y * p.y);
    // Allow a tiny epsilon for floating-point.
    expect(d).toBeLessThanOrEqual(max + 0.01);
  });

  it("even under sustained repulsion from a grabbed neighbor, the cap holds", () => {
    // Grabbed card sits right on top of the anchor; repulsion would
    // otherwise push the neighbor arbitrarily far. The cap must
    // prevent that.
    const n: PhysicsNode[] = [
      { id: "card:pusher", x: 0, y: 0, grabbed: true },
      { id: "card:neighbor", x: 30, y: 0, grabbed: false },
    ];
    const a = anchors(["card:pusher", 0, 0], ["card:neighbor", 30, 0]);
    const velocities = new Map<string, Velocity>();
    let pos = { x: 30, y: 0 };
    for (let i = 0; i < 100; i++) {
      const nodes_i: PhysicsNode[] = [
        { id: "card:pusher", x: 0, y: 0, grabbed: true },
        { id: "card:neighbor", x: pos.x, y: pos.y, grabbed: false },
      ];
      const { newPositions } = stepPhysics(nodes_i, a, velocities, DEFAULT_PARAMS);
      pos = newPositions.get("card:neighbor")!;
    }
    // Anchor at (30, 0); maxDisplacement = 180. So the neighbor's
    // farthest possible position is anywhere on a circle of radius
    // 180 centered at (30, 0).
    const dxFromAnchor = pos.x - 30;
    const dyFromAnchor = pos.y - 0;
    const d = Math.sqrt(dxFromAnchor * dxFromAnchor + dyFromAnchor * dyFromAnchor);
    expect(d).toBeLessThanOrEqual(DEFAULT_PARAMS.maxDisplacement + 0.01);
  });

  it("a card pushed off-anchor by repulsion still drifts back when the pusher leaves", () => {
    // First: grabbed pusher at (0,0), neighbor at anchor (80,0).
    // Step a few times → neighbor displaced rightward.
    // Then remove the pusher and verify neighbor decays back to (80,0).
    const a = anchors(["card:pusher", 0, 0], ["card:neighbor", 80, 0]);
    const velocities = new Map<string, Velocity>();
    let neighborPos = { x: 80, y: 0 };

    for (let i = 0; i < 30; i++) {
      const n: PhysicsNode[] = [
        { id: "card:pusher", x: 0, y: 0, grabbed: true },
        { id: "card:neighbor", x: neighborPos.x, y: neighborPos.y, grabbed: false },
      ];
      const { newPositions } = stepPhysics(n, a, velocities, DEFAULT_PARAMS);
      neighborPos = newPositions.get("card:neighbor")!;
    }
    // Significant displacement away from the pusher.
    expect(neighborPos.x).toBeGreaterThan(90);

    // Now drop the pusher's grabbed state (and remove it from the
    // node list — gone entirely). The neighbor should drift back to
    // its anchor at (80,0).
    for (let i = 0; i < 400; i++) {
      const n: PhysicsNode[] = [
        { id: "card:neighbor", x: neighborPos.x, y: neighborPos.y, grabbed: false },
      ];
      const { newPositions } = stepPhysics(n, a, velocities, DEFAULT_PARAMS);
      neighborPos = newPositions.get("card:neighbor")!;
    }
    expect(neighborPos.x).toBeCloseTo(80, 0);
  });
});
