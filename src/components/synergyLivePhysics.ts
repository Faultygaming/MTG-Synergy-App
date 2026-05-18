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
//   - Anchor spring: each card is pulled toward its packed position
//     (its "preferred location"). Strong by default, so the layout's
//     visual structure is preserved across drags.
//   - Repulsion: nearby cards push each other apart with inverse-
//     square falloff. Cuts off beyond ~300px so distant cards don't
//     leak forces across the canvas.
//   - Damping + velocity cap: keeps the simulation stable.
//
// The result: dragging pushes neighbors out of the way fluidly, then
// when released, everything (including the dragged card) springs back
// toward its anchor — matching the user's "snap back to preferred
// location of connections" intent.
//
// Loop lifecycle: starts on `grab`/`drag`/`free`, runs every frame
// while any node is grabbed or the system's kinetic energy is above
// a small threshold, then idles until the next interaction.

interface State {
  anchors: Map<string, { x: number; y: number }>;
  velocities: Map<string, { vx: number; vy: number }>;
  rafId: number | null;
  active: boolean;
}

interface Options {
  repulseK?: number;
  anchorK?: number;
  damping?: number;
  vmax?: number;
  // Pairs farther apart than `repulseRange` skip the repulsion
  // calculation entirely. Avoids O(N²) blowup distorting the layout
  // when one corner has dense neighbors.
  repulseRange?: number;
  // Kinetic energy below which the loop sleeps.
  keThreshold?: number;
}

export function attachLivePhysics(cy: Core, opts: Options = {}): () => void {
  const REPULSE_K = opts.repulseK ?? 14000;
  const ANCHOR_K = opts.anchorK ?? 0.06;
  const DAMPING = opts.damping ?? 0.74;
  const VMAX = opts.vmax ?? 30;
  const REPULSE_RANGE = opts.repulseRange ?? 320;
  const REPULSE_RANGE_SQ = REPULSE_RANGE * REPULSE_RANGE;
  const KE_THRESHOLD = opts.keThreshold ?? 0.5;

  const state: State = {
    anchors: new Map(),
    velocities: new Map(),
    rafId: null,
    active: false,
  };

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

  function step() {
    // Collect card-node snapshots. We touch cytoscape's getters once
    // per frame and write positions once at the end.
    interface NodeView {
      id: string;
      x: number;
      y: number;
      grabbed: boolean;
    }
    const nodes: NodeView[] = [];
    cy.nodes().forEach((n) => {
      const id = String(n.id());
      if (!id.startsWith("card:")) return;
      const pos = n.position();
      nodes.push({ id, x: pos.x, y: pos.y, grabbed: n.grabbed() });
    });

    const forces: Array<{ fx: number; fy: number }> = new Array(nodes.length);
    for (let i = 0; i < nodes.length; i++) forces[i] = { fx: 0, fy: 0 };

    // Pairwise repulsion with distance cutoff.
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const d2 = dx * dx + dy * dy + 1;
        if (d2 > REPULSE_RANGE_SQ) continue;
        const d = Math.sqrt(d2);
        const f = REPULSE_K / d2;
        const ux = dx / d;
        const uy = dy / d;
        forces[i].fx += ux * f;
        forces[i].fy += uy * f;
        forces[j].fx -= ux * f;
        forces[j].fy -= uy * f;
      }
    }

    // Anchor spring — pulls each card back toward its packed position.
    for (let i = 0; i < nodes.length; i++) {
      const a = state.anchors.get(nodes[i].id);
      if (!a) continue;
      forces[i].fx += ANCHOR_K * (a.x - nodes[i].x);
      forces[i].fy += ANCHOR_K * (a.y - nodes[i].y);
    }

    // Integrate. Skip the dragged node — cytoscape moves it from the
    // pointer position; we just zero its velocity so it doesn't shoot
    // off when released.
    let totalKE = 0;
    let anyGrabbed = false;
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (n.grabbed) {
        state.velocities.set(n.id, { vx: 0, vy: 0 });
        anyGrabbed = true;
        continue;
      }
      let v = state.velocities.get(n.id);
      if (!v) {
        v = { vx: 0, vy: 0 };
        state.velocities.set(n.id, v);
      }
      v.vx = (v.vx + forces[i].fx) * DAMPING;
      v.vy = (v.vy + forces[i].fy) * DAMPING;
      const sp = Math.sqrt(v.vx * v.vx + v.vy * v.vy);
      if (sp > VMAX) {
        v.vx = (v.vx / sp) * VMAX;
        v.vy = (v.vy / sp) * VMAX;
      }
      totalKE += v.vx * v.vx + v.vy * v.vy;
      cy.getElementById(n.id).position({
        x: n.x + v.vx,
        y: n.y + v.vy,
      });
    }

    if (anyGrabbed || totalKE > KE_THRESHOLD) {
      state.rafId = requestAnimationFrame(step);
    } else {
      state.active = false;
      state.rafId = null;
    }
  }

  function startLoop() {
    if (state.active) return;
    state.active = true;
    state.rafId = requestAnimationFrame(step);
  }

  // Re-snapshot anchors whenever the underlying packed layout finishes
  // (mode switch, add/remove card) so cards spring back to the new
  // positions, not the original ones.
  cy.on("layoutstop", snapshot);
  cy.on("grab", "node", startLoop);
  cy.on("free", "node", startLoop);
  cy.on("drag", "node", startLoop);
  // Snapshot once at initialization.
  cy.ready(snapshot);
  if (cy.nodes().length > 0) snapshot();

  return () => {
    cy.off("layoutstop", snapshot);
    cy.off("grab", "node", startLoop);
    cy.off("free", "node", startLoop);
    cy.off("drag", "node", startLoop);
    if (state.rafId !== null) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
    state.active = false;
  };
}
