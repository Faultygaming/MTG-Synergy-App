// Variant C — preset cards on top + per-rule overrides below in an
// expandable "Custom" section. Mirrors how Magic players actually talk
// about house rules: pick the playgroup, override the specifics.
//
// Pros: matches user mental model, one click for 95% of cases.
// Cons: more vertical space, two-level navigation.

"use client";

import { useMemo, useState } from "react";
import clsx from "clsx";
import type { CommanderRulesConfig, RuleSeverity } from "@/lib/commander/rules";
import { RULES, PRESETS, DEFAULT_CONFIG, isSamePreset } from "./shared";

const SEVS: RuleSeverity[] = ["off", "warn", "block"];
const SEV_CLASS: Record<RuleSeverity, string> = {
  off: "bg-ink-line text-stone-500",
  warn: "bg-amber-700/40 text-amber-100 ring-1 ring-amber-600/60",
  block: "bg-red-900/40 text-red-200 ring-1 ring-red-700/60",
};

export function VariantC_Presets() {
  const [config, setConfig] = useState<CommanderRulesConfig>(DEFAULT_CONFIG);
  const [expanded, setExpanded] = useState(false);
  const activePresetId = useMemo(() => {
    return PRESETS.find((p) => isSamePreset(p.config, config))?.id ?? null;
  }, [config]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        {PRESETS.map((p) => {
          const active = activePresetId === p.id;
          return (
            <button
              key={p.id}
              onClick={() => setConfig({ ...p.config })}
              className={clsx(
                "rounded border p-2 text-left transition-colors",
                active
                  ? "border-tier-gold bg-tier-gold/10 text-tier-gold"
                  : "border-ink-line bg-ink/60 text-stone-300 hover:border-stone-600 hover:text-stone-100",
              )}
            >
              <div className="text-xs font-semibold">{p.name}</div>
              <div className="mt-0.5 text-[10px] leading-snug text-stone-500">
                {p.blurb}
              </div>
            </button>
          );
        })}
      </div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center justify-between rounded border border-ink-line bg-ink/40 px-2.5 py-1.5 text-[11px] text-stone-300 hover:text-stone-100"
      >
        <span>
          {expanded ? "Hide" : "Override individual rules"}
          {!activePresetId && (
            <span className="ml-2 rounded bg-amber-700/30 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-amber-200">
              custom
            </span>
          )}
        </span>
        <span aria-hidden className="text-stone-500">{expanded ? "▴" : "▾"}</span>
      </button>
      {expanded && (
        <ul className="space-y-1.5">
          {RULES.map((r) => (
            <li
              key={r.key}
              className="flex items-center justify-between gap-2 rounded border border-ink-line bg-ink/60 px-2 py-1"
            >
              <div className="min-w-0">
                <div className="text-xs font-medium text-stone-200">{r.label}</div>
                <div className="truncate text-[10px] text-stone-500">{r.hint}</div>
              </div>
              <div className="flex shrink-0 gap-1">
                {SEVS.map((sev) => (
                  <button
                    key={sev}
                    onClick={() => setConfig({ ...config, [r.key]: sev })}
                    className={clsx(
                      "rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
                      config[r.key] === sev
                        ? SEV_CLASS[sev]
                        : "bg-transparent text-stone-500 ring-1 ring-ink-line hover:text-stone-300",
                    )}
                  >
                    {sev}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
