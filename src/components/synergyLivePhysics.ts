import type { Core } from "cytoscape";

// Live physics for the SynergyMap.
//
// The static layouts (packPieCloud / packPlanetary / packForce) compute
// each card's "preferred location of connections" once and hand it to
// Cytoscape as a preset position. Without this module, those positions
// are frozen — drag a card and it stays where you drop it, with edges
// dragged out of shape and no fluid response from neighbors.
//
// This module wakes cytoscape up: whenever a node is grabbed or
// dragged, a requestAnimationFrame loop runs forces over the card
// nodes:
//
//   - Anchor spring: each non-grabbed card is pulled toward its
//     packed position (its "preferred location"). After a card is
//     released, this is what snaps it back.
//   - Repulsion: every pair of cards pushes apart with inverse-
//     square falloff. Strong enough that dragging a card visibly
//     shoves nearby neighbors aside.
//   - Damping + velocity cap: keeps the simulation stable.
//
// The loop sleeps once everything has come to rest, so idle cost is
// zero between interactions.

export interface PhysicsNode {
  id: string;
  x: number;
  y: number;
  grabbed: boolean;
}

export interface Vec2 {
  x: number;
  y: number;
}

export interface Velocity {
  vx: number;
  vy: number;
}

export interface PhysicsParams {
  repulseK: number;
  // Linear anchor spring constant. Gentle at small displacements so
  // wiggles feel soft.
  anchorK: number;
  // Quadratic anchor spring constant. Grows with distance squared, so
  // the restoring force ramps up sharply once a card is far from its
  // anchor — "rubber band tightens the more you stretch it".
  anchorK2: number;
  damping: number;
  vmax: number;
  // Hard cutoff on pairwise repulsion distance. Pairs farther apart
  // than this skip the calculation entirely.
  repulseRange: number;
  // Hard cap: no card may sit more than `maxDisplacement` model units
  // away from its anchor. After each integration step, positions are
  // projected back onto a circle of this radius around the anchor.
  // This is the "magnetic limit" — cards literally cannot drift past
  // it no matter how hard they're pushed.
  maxDisplacement: number;
}

export const DEFAULT_PARAMS: PhysicsParams = {
  // Tuned 2026-05 after the user reported "they spread out, but they
  // should have hard limits / snap back tighter":
  //   - Halved repulseK so dragging pushes neighbors visibly without
  //     blasting them across the canvas.
  //   - Added quadratic anchor term + hard maxDisplacement so the
  //     rubber-band feel kicks in well before the cap.
  //   - Lowered vmax so individual frames can't relocate a card far.
  repulseK: 25000,
  anchorK: 0.04,
  anchorK2: 0.0008,
  damping: 0.78,
  vmax: 25,
  repulseRange: 500,
  maxDisplacement: 180,
};

// Pure simulation step. Mutates `velocities` in place; returns the
// new positions keyed by id (only non-grabbed nodes appear in the
// result — caller skips applying positions for grabbed nodes).
//
// Exposed (not just internal to attachLivePhysics) so the math can be
// exercised in unit tests without mocking the entire Cytoscape event
// loop.
export function stepPhysics(
  nodes: ReadonlyArray<PhysicsNode>,
  anchors: ReadonlyMap<string, Vec2>,
  velocities: Map<string, Velocity>,
  params: PhysicsParams = DEFAULT_PARAMS,
): {
  newPositions: Map<string, Vec2>;
  totalKE: number;
  anyGrabbed: boolean;
} {
  const {
    repulseK,
    anchorK,
    anchorK2,
    damping,
    vmax,
    repulseRange,
    maxDisplacement,
  } = params;
  const rangeSq = repulseRange * repulseRange;
  const maxDispSq = maxDisplacement * maxDisplacement;
  const newPositions = new Map<string, Vec2>();

  const forces: Array<Vec2> = new Array(nodes.length);
  for (let i = 0; i < nodes.length; i++) forces[i] = { x: 0, y: 0 };

  // Pairwise repulsion with distance cutoff.
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i];
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const d2 = dx * dx + dy * dy + 1;
      if (d2 > rangeSq) continue;
      const d = Math.sqrt(d2);
      const f = repulseK / d2;
      const ux = dx / d;
      const uy = dy / d;
      forces[i].x += ux * f;
      forces[i].y += uy * f;
      forces[j].x -= ux * f;
      forces[j].y -= uy * f;
    }
  }

  // Anchor spring — pull each card back toward its packed position.
  // Linear term gives a soft initial pull; quadratic term ensures
  // big displacements feel like a tightening rubber band, not a
  // gradually-weakening string.
  for (let i = 0; i < nodes.length; i++) {
    const a = anchors.get(nodes[i].id);
    if (!a) continue;
    const dx = a.x - nodes[i].x;
    const dy = a.y - nodes[i].y;
    const d2 = dx * dx + dy * dy;
    const d = Math.sqrt(d2);
    if (d < 0.001) continue;
    // f = (anchorK + anchorK2 * d) * d, written so we can reuse dx/dy
    // as the direction. The quadratic coefficient applies to |d|, not
    // |d|² of the *vector*, so the resulting force magnitude grows
    // quadratically while remaining radially aligned.
    const fMag = anchorK * d + anchorK2 * d2;
    const ux = dx / d;
    const uy = dy / d;
    forces[i].x += ux * fMag;
    forces[i].y += uy * fMag;
  }

  // Integrate.
  let totalKE = 0;
  let anyGrabbed = false;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.grabbed) {
      // Cytoscape controls the grabbed node's position from the
      // pointer. Zero its velocity so it doesn't shoot off on
      // release.
      velocities.set(n.id, { vx: 0, vy: 0 });
      anyGrabbed = true;
      continue;
    }
    let v = velocities.get(n.id);
    if (!v) {
      v = { vx: 0, vy: 0 };
      velocities.set(n.id, v);
    }
    v.vx = (v.vx + forces[i].x) * damping;
    v.vy = (v.vy + forces[i].y) * damping;
    const sp = Math.sqrt(v.vx * v.vx + v.vy * v.vy);
    if (sp > vmax) {
      v.vx = (v.vx / sp) * vmax;
      v.vy = (v.vy / sp) * vmax;
    }
    let nx = n.x + v.vx;
    let ny = n.y + v.vy;

    // Hard distance cap: project the position back onto a circle of
    // radius maxDisplacement around the anchor. This is the magnetic
    // limit the user asked for — cards literally cannot leave their
    // anchor's territory, no matter how hard they're pushed.
    const a = anchors.get(n.id);
    if (a) {
      const rx = nx - a.x;
      const ry = ny - a.y;
      const rd2 = rx * rx + ry * ry;
      if (rd2 > maxDispSq) {
        const rd = Math.sqrt(rd2);
        const ux = rx / rd;
        const uy = ry / rd;
        nx = a.x + ux * maxDisplacement;
        ny = a.y + uy * maxDisplacement;
        // Strip the outward-radial component of velocity so the card
        // doesn't fight the wall every frame (which would manifest as
        // a constant push against the cap that wastes simulation
        // budget and makes the snap-back feel sluggish).
        const radial = v.vx * ux + v.vy * uy;
        if (radial > 0) {
          v.vx -= radial * ux;
          v.vy -= radial * uy;
        }
      }
    }
    totalKE += v.vx * v.vx + v.vy * v.vy;
    newPositions.set(n.id, { x: nx, y: ny });
  }

  return { newPositions, totalKE, anyGrabbed };
}

interface State {
  anchors: Map<string, Vec2>;
  velocities: Map<string, Velocity>;
  rafId: number | null;
  active: boolean;
}

interface AttachOptions extends Partial<PhysicsParams> {
  // Optional sink for "physics is currently running" state. Lets the
  // host component show a visible indicator so users can confirm the
  // loop is alive when something seems wrong.
  onActiveChange?: (active: boolean) => void;
}

export function attachLivePhysics(
  cy: Core,
  opts: AttachOptions = {},
): () => void {
  const params: PhysicsParams = { ...DEFAULT_PARAMS, ...opts };

  const state: State = {
    anchors: new Map(),
    velocities: new Map(),
    rafId: null,
    active: false,
  };

  function setActive(v: boolean) {
    if (state.active === v) return;
    state.active = v;
    opts.onActiveChange?.(v);
  }

  function snapshot() {
    state.anchors.clear();
    state.velocities.clear();
    cy.nodes().forEach((n) => {
      const id = String(n.id());
      if (!id.startsWith("card:")) return;
      const p = n.position();
      state.anchors.set(id, { x: p.x, y: p.y });
    });
  }

  function loopStep() {
    const nodes: PhysicsNode[] = [];
    cy.nodes().forEach((n) => {
      const id = String(n.id());
      if (!id.startsWith("card:")) return;
      const pos = n.position();
      nodes.push({ id, x: pos.x, y: pos.y, grabbed: n.grabbed() });
    });

    const { newPositions, totalKE, anyGrabbed } = stepPhysics(
      nodes,
      state.anchors,
      state.velocities,
      params,
    );

    // Apply positions in a batch — cytoscape will redraw once.
    cy.batch(() => {
      for (const [id, pos] of newPositions) {
        cy.getElementById(id).position(pos);
      }
    });

    if (anyGrabbed || totalKE > 0.5) {
      state.rafId = requestAnimationFrame(loopStep);
    } else {
      setActive(false);
      state.rafId = null;
    }
  }

  function startLoop() {
    if (state.active) return;
    setActive(true);
    state.rafId = requestAnimationFrame(loopStep);
  }

  cy.on("layoutstop", snapshot);
  cy.on("grab", "node", startLoop);
  cy.on("drag", "node", startLoop);
  cy.on("free", "node", startLoop);
  cy.ready(snapshot);
  if (cy.nodes().length > 0) snapshot();

  return () => {
    cy.off("layoutstop", snapshot);
    cy.off("grab", "node", startLoop);
    cy.off("drag", "node", startLoop);
    cy.off("free", "node", startLoop);
    if (state.rafId !== null) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
    setActive(false);
  };
}
