// Variant D — each rule is a full card with expandable help text and a
// segmented control. Most space-consuming, most "professional" feel.
//
// Pros: best onboarding (you read what each rule means before changing
// it). Honors that not every user knows MTG Commander rules cold.
// Cons: tall — needs scroll on the deck page's collapsed details area.

"use client";

import { useState } from "react";
import clsx from "clsx";
import type { CommanderRulesConfig, RuleSeverity } from "@/lib/commander/rules";
import { RULES, DEFAULT_CONFIG } from "./shared";

const SEVS: RuleSeverity[] = ["off", "warn", "block"];
const SEV_LABEL: Record<RuleSeverity, string> = {
  off: "Off",
  warn: "Warn",
  block: "Block",
};
const SEV_DOT: Record<RuleSeverity, string> = {
  off: "bg-stone-500/40",
  warn: "bg-amber-500",
  block: "bg-red-500",
};
const SEV_BADGE: Record<RuleSeverity, string> = {
  off: "bg-ink-line text-stone-400 ring-1 ring-ink-line",
  warn: "bg-amber-700/40 text-amber-200 ring-1 ring-amber-600/60",
  block: "bg-red-900/40 text-red-200 ring-1 ring-red-700/60",
};

export function VariantD_ExpandableCards() {
  const [config, setConfig] = useState<CommanderRulesConfig>(DEFAULT_CONFIG);
  const [openRule, setOpenRule] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-[11px] text-stone-400">
          <input
            type="checkbox"
            checked={config.globalMode === "warn"}
            onChange={(e) =>
              setConfig({
                ...config,
                globalMode: e.target.checked ? "warn" : "strict",
              })
            }
            className="accent-amber-500"
          />
          Permissive mode — downgrade every block to warn
        </label>
      </div>
      <ul className="space-y-1.5">
        {RULES.map((r) => {
          const sev = config[r.key];
          const open = openRule === r.key;
          return (
            <li
              key={r.key}
              className="overflow-hidden rounded border border-ink-line bg-ink/60"
            >
              <button
                onClick={() => setOpenRule(open ? null : r.key)}
                className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left"
              >
                <span className={clsx("h-2 w-2 shrink-0 rounded-full", SEV_DOT[sev])} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium text-stone-100">{r.label}</div>
                  <div className="truncate text-[10px] text-stone-500">{r.hint}</div>
                </div>
                <span
                  className={clsx(
                    "shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                    SEV_BADGE[sev],
                  )}
                >
                  {SEV_LABEL[sev]}
                </span>
                <span aria-hidden className="shrink-0 text-stone-600">
                  {open ? "▴" : "▾"}
                </span>
              </button>
              {open && (
                <div className="space-y-2 border-t border-ink-line bg-ink/40 px-3 py-2 text-[11px]">
                  <p className="leading-snug text-stone-400">{r.long}</p>
                  <div className="space-y-0.5 text-[10px] text-stone-500">
                    <div>
                      <span className="text-red-400">At block:</span> {r.exampleAtBlock}
                    </div>
                    <div>
                      <span className="text-amber-400">At warn:</span> {r.exampleAtWarn}
                    </div>
                  </div>
                  <div className="flex gap-1 pt-1">
                    {SEVS.map((next) => (
                      <button
                        key={next}
                        onClick={() => setConfig({ ...config, [r.key]: next })}
                        className={clsx(
                          "flex-1 rounded py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors",
                          config[r.key] === next
                            ? SEV_BADGE[next]
                            : "bg-transparent text-stone-500 ring-1 ring-ink-line hover:text-stone-300",
                        )}
                      >
                        {SEV_LABEL[next]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
