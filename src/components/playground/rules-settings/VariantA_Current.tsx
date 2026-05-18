// Variant A — baseline (current production component, no API call).
// Included so the side-by-side comparison shows a clear "before".

"use client";

import { useState } from "react";
import clsx from "clsx";
import type { CommanderRulesConfig, RuleSeverity } from "@/lib/commander/rules";
import { RULES, DEFAULT_CONFIG } from "./shared";

const SEVS: RuleSeverity[] = ["off", "warn", "block"];
const SEV_CLASS: Record<RuleSeverity, string> = {
  off: "bg-ink-line text-stone-500",
  warn: "bg-amber-700/40 text-amber-200 ring-1 ring-amber-700/60",
  block: "bg-red-900/40 text-red-200 ring-1 ring-red-700/60",
};

export function VariantA_Current() {
  const [config, setConfig] = useState<CommanderRulesConfig>(DEFAULT_CONFIG);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-stone-300">
          <span className="text-stone-500">Mode:</span>
          <select
            value={config.globalMode ?? "strict"}
            onChange={(e) =>
              setConfig({ ...config, globalMode: e.target.value as "strict" | "warn" })
            }
            className="rounded border border-ink-line bg-ink px-2 py-1 text-xs"
          >
            <option value="strict">Strict (block everything set to block)</option>
            <option value="warn">Permissive (downgrade every block to warn)</option>
          </select>
        </label>
        <button className="rounded bg-tier-gold px-3 py-1 text-xs font-semibold text-ink">
          Save rules
        </button>
      </div>
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
    </div>
  );
}
