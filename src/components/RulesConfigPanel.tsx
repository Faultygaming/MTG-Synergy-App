"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import type {
  CommanderRulesConfig,
  RuleSeverity,
} from "@/lib/commander/rules";
import {
  COMMANDER_PRESETS,
  detectPreset,
  isSamePreset,
} from "@/lib/commander/presets";

const RULES: Array<{
  key: keyof Omit<CommanderRulesConfig, "globalMode">;
  label: string;
  hint: string;
}> = [
  { key: "commanderLegality", label: "Commander legality", hint: "Legendary type + eligibility (creature / vehicle / spacecraft / PW)" },
  { key: "deckSize",          label: "Deck size (100)",   hint: "Total must equal 100 (commander + 99)" },
  { key: "singleton",         label: "Singleton",         hint: "1 of each non-basic, except 'any number of' cards" },
  { key: "colorIdentity",     label: "Color identity",    hint: "Every card's CI ⊆ commander CI" },
  { key: "banlist",           label: "Banlist",           hint: "Commander RC banned cards" },
];

const SEVS: RuleSeverity[] = ["off", "warn", "block"];

const SEV_CLASS: Record<RuleSeverity, string> = {
  off: "bg-ink-line text-stone-500",
  warn: "bg-amber-700/40 text-amber-100 ring-1 ring-amber-600/60",
  block: "bg-red-900/40 text-red-200 ring-1 ring-red-700/60",
};

interface Props {
  deckId: string;
  initial: CommanderRulesConfig;
}

// Rules-settings panel: pick a preset (Tournament / Casual / Sandbox)
// with one click, or expand "override individual rules" to tweak any
// individual rule's severity. Config changes auto-save against
// PATCH /api/decks/[id]/rules with a 600ms debounce — no save button.
export function RulesConfigPanel({ deckId, initial }: Props) {
  const [config, setConfig] = useState<CommanderRulesConfig>(initial);
  const [expanded, setExpanded] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const activePresetId = useMemo(() => detectPreset(config), [config]);
  const initialRef = useRef(initial);
  const debounceRef = useRef<number | null>(null);

  // Auto-save: any change to `config` schedules a PATCH after a brief
  // debounce. Don't fire on the initial mount — only when the user has
  // actually edited the config away from what was loaded from the DB.
  useEffect(() => {
    if (isSamePreset(config, initialRef.current)) return;
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(async () => {
      setSaveState("saving");
      try {
        const res = await fetch(`/api/decks/${deckId}/rules`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
        });
        if (!res.ok) throw new Error(String(res.status));
        setSaveState("saved");
        // Update the "initial" reference so we don't keep re-saving the
        // same config on unrelated re-renders.
        initialRef.current = config;
        window.setTimeout(() => setSaveState("idle"), 1200);
      } catch {
        setSaveState("error");
      }
    }, 600);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [config, deckId]);

  return (
    <div className="space-y-3">
      {/* Preset picker — three cards across. The active preset (if any)
        * gets a gold border; "custom" status surfaces in the overrides
        * disclosure below. */}
      <div className="grid grid-cols-3 gap-2">
        {COMMANDER_PRESETS.map((p) => {
          const active = activePresetId === p.id;
          return (
            <button
              key={p.id}
              onClick={() => setConfig({ ...p.config })}
              title={p.blurb}
              className={clsx(
                "rounded border p-2 text-left transition-colors",
                active
                  ? "border-tier-gold bg-tier-gold/10 text-tier-gold"
                  : "border-ink-line bg-ink/60 text-stone-300 hover:border-stone-600 hover:text-stone-100",
              )}
            >
              <div className="text-xs font-semibold">{p.name}</div>
              <div className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-stone-500">
                {p.blurb}
              </div>
            </button>
          );
        })}
      </div>

      {/* Save status + overrides toggle row */}
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex flex-1 items-center justify-between rounded border border-ink-line bg-ink/40 px-2.5 py-1.5 text-[11px] text-stone-300 hover:text-stone-100"
        >
          <span>
            {expanded ? "Hide overrides" : "Override individual rules"}
            {!activePresetId && (
              <span className="ml-2 rounded bg-amber-700/30 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-amber-200">
                custom
              </span>
            )}
          </span>
          <span aria-hidden className="text-stone-500">
            {expanded ? "▴" : "▾"}
          </span>
        </button>
        <SaveBadge state={saveState} />
      </div>

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

function SaveBadge({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  if (state === "idle") return <span className="w-14" aria-hidden />;
  const cls =
    state === "saving"
      ? "text-stone-400"
      : state === "saved"
        ? "text-tier-gold"
        : "text-red-300";
  const label =
    state === "saving" ? "Saving…" : state === "saved" ? "Saved" : "Save failed";
  return (
    <span className={clsx("w-14 text-right text-[10px]", cls)}>{label}</span>
  );
}
