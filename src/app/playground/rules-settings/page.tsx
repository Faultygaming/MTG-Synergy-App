// Playground route: side-by-side comparison of rules-settings variants.
//
// Each variant uses local React state with the default config; nothing
// hits the API, so this page is safe to view against any deck (or none).
// Pick the variant you want and tell me which letter; I'll wire its
// patterns into src/components/RulesConfigPanel and delete the rest.
//
// URL: /playground/rules-settings
import { VariantA_Current } from "@/components/playground/rules-settings/VariantA_Current";
import { VariantB_CycleChips } from "@/components/playground/rules-settings/VariantB_CycleChips";
import { VariantC_Presets } from "@/components/playground/rules-settings/VariantC_Presets";
import { VariantD_ExpandableCards } from "@/components/playground/rules-settings/VariantD_ExpandableCards";

interface VariantPanel {
  letter: string;
  name: string;
  blurb: string;
  Component: () => React.ReactNode;
}

const VARIANTS: VariantPanel[] = [
  {
    letter: "A",
    name: "Baseline (current)",
    blurb:
      "What's in production today. Mode dropdown + three buttons per rule + a manual Save button.",
    Component: VariantA_Current,
  },
  {
    letter: "B",
    name: "Cycle chips, auto-save",
    blurb:
      "One chip per rule; click to cycle off → warn → block. Permissive-mode pill on top. Densest.",
    Component: VariantB_CycleChips,
  },
  {
    letter: "C",
    name: "Presets + overrides",
    blurb:
      "Pick a preset (Tournament / Casual / Sandbox) up top. Detailed per-rule controls expand on demand.",
    Component: VariantC_Presets,
  },
  {
    letter: "D",
    name: "Expandable rule cards",
    blurb:
      "Each rule is a card with a status dot + state badge. Expand for help text + examples + segmented control.",
    Component: VariantD_ExpandableCards,
  },
];

export default function RulesSettingsPlaygroundPage() {
  return (
    <main className="min-h-screen px-6 py-10">
      <header className="mx-auto mb-8 max-w-6xl">
        <h1 className="text-2xl font-bold text-tier-gold">
          Rules-settings playground
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-stone-400">
          Side-by-side comparison of four UX designs for the Commander
          rules panel. Each variant is wired to local state only — no API
          calls. Try clicking around in each. Tell me which letter (A/B/C/D)
          you want and I'll wire that variant into production at{" "}
          <code className="text-stone-300">src/components/RulesConfigPanel.tsx</code>{" "}
          and delete the others.
        </p>
      </header>
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-6 lg:grid-cols-2">
        {VARIANTS.map((v) => (
          <section
            key={v.letter}
            className="rounded-lg border border-ink-line bg-ink-soft p-4"
          >
            <header className="mb-3">
              <h2 className="flex items-baseline gap-2 text-sm font-semibold text-stone-100">
                <span className="rounded bg-tier-gold/20 px-1.5 py-0.5 text-xs font-bold text-tier-gold">
                  {v.letter}
                </span>
                {v.name}
              </h2>
              <p className="mt-1 text-[11px] leading-snug text-stone-500">
                {v.blurb}
              </p>
            </header>
            <div className="rounded border border-ink-line bg-ink p-3">
              <v.Component />
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
