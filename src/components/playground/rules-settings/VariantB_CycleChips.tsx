// Variant B — single click-to-cycle chip per rule; auto-saves; one
// permissive-mode pill instead of a dropdown.
//
// Pros: dense, fast to scan, single tap to change. No save button —
// changes apply immediately (in production: debounced PATCH).
// Cons: less affordance for first-time users (chip's a button, not
// obvious until you hover).

"use client";

import { useState } from "react";
import clsx from "clsx";
import type { CommanderRulesConfig, RuleSeverity } from "@/lib/commander/rules";
import { RULES, DEFAULT_CONFIG } from "./shared";

const NEXT: Record<RuleSeverity, RuleSeverity> = {
  off: "warn",
  warn: "block",
  block: "off",
};
const SEV_CHIP: Record<RuleSeverity, { label: string; cls: string }> = {
  off: { label: "OFF", cls: "bg-ink-line text-stone-500 ring-1 ring-ink-line" },
  warn: { label: "WARN", cls: "bg-amber-700/40 text-amber-100 ring-1 ring-amber-600/60" },
  block: { label: "BLOCK", cls: "bg-red-900/40 text-red-200 ring-1 ring-red-700/60" },
};

export function VariantB_CycleChips() {
  const [config, setConfig] = useState<CommanderRulesConfig>(DEFAULT_CONFIG);
  const permissive = config.globalMode === "warn";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() =>
            setConfig({ ...config, globalMode: permissive ? "strict" : "warn" })
          }
          className={clsx(
            "rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider transition-colors",
            permissive
              ? "bg-amber-500/20 text-amber-200 ring-1 ring-amber-500/50"
              : "bg-ink-line text-stone-400 ring-1 ring-ink-line hover:text-stone-200",
          )}
        >
          {permissive ? "Permissive mode" : "Strict mode"}
        </button>
        <span className="text-[10px] text-stone-500">
          {permissive ? "downgrades every block → warn" : "click any chip to cycle"}
        </span>
      </div>
      <ul className="divide-y divide-ink-line/60 rounded border border-ink-line bg-ink/60">
        {RULES.map((r) => {
          const sev = config[r.key];
          const chip = SEV_CHIP[sev];
          return (
            <li
              key={r.key}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="text-xs font-medium text-stone-100">{r.label}</div>
                <div className="truncate text-[10px] text-stone-500">{r.hint}</div>
              </div>
              <button
                onClick={() => setConfig({ ...config, [r.key]: NEXT[sev] })}
                title={`Click to cycle (next: ${NEXT[sev]})`}
                className={clsx(
                  "shrink-0 rounded px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors",
                  chip.cls,
                )}
              >
                {chip.label}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
