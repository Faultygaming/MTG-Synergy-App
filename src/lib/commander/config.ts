// Per-rule configuration for the Commander rules engine.
//
// Each rule can be set independently to:
//   - "block": violations are reported as severity "block" — the UI surfaces
//     them as errors and the app should refuse actions that would introduce
//     new violations (e.g. adding a banned card).
//   - "warn":  violations are reported as severity "warn" — the UI shows
//     them in a softer banner; actions are NOT blocked. Useful for casual /
//     proxy-friendly playgroups.
//   - "off":   the check is skipped entirely; no violations of this kind
//     will be emitted.
//
// `globalMode: "warn"` is a convenience override that downgrades every
// "block" rule to "warn" without rewriting each entry. Useful for a
// per-deck "permissive mode" toggle in the UI.

export type RuleSeverity = "off" | "warn" | "block";

export interface CommanderRulesConfig {
  deckSize: RuleSeverity;
  singleton: RuleSeverity;
  colorIdentity: RuleSeverity;
  banlist: RuleSeverity;
  commanderLegality: RuleSeverity;
  // If set, downgrades all "block" → "warn" everywhere. "off" rules stay off.
  globalMode?: "strict" | "warn";
}

export const DEFAULT_CONFIG: CommanderRulesConfig = {
  deckSize: "block",
  singleton: "block",
  colorIdentity: "block",
  banlist: "block",
  commanderLegality: "block",
  globalMode: "strict",
};

export function effectiveSeverity(
  rule: keyof Omit<CommanderRulesConfig, "globalMode">,
  config: CommanderRulesConfig,
): RuleSeverity {
  const raw = config[rule];
  if (raw === "off") return "off";
  if (config.globalMode === "warn" && raw === "block") return "warn";
  return raw;
}
