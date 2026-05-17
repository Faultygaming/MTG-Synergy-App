// Parser for plain-text decklists. Tolerates the common formats users paste:
//
//   "4 Lightning Bolt"
//   "4x Lightning Bolt"
//   "Lightning Bolt"
//   "1 Sol Ring (CMR) 309"     <- ignore set / collector suffix
//   "// Mainboard"             <- comments, skipped
//
// Returns a list of { name, quantity } in input order, with duplicates merged.

export interface ParsedLine {
  name: string;
  quantity: number;
}

const LINE_RE = /^\s*(?:(\d+)\s*x?\s+)?([^()/]+?)(?:\s*\([^)]+\)\s*\d*\s*)?\s*$/i;

export function parseDecklist(input: string): ParsedLine[] {
  const byName = new Map<string, number>();
  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("//") || line.startsWith("#")) continue;
    // Skip section headers like "Sideboard" / "Mainboard".
    if (/^(side|main|commander|companion)board?$/i.test(line.replace(/[:=].*$/, "").trim())) continue;
    const m = line.match(LINE_RE);
    if (!m) continue;
    const quantity = m[1] ? parseInt(m[1], 10) : 1;
    const name = m[2].trim();
    if (!name) continue;
    byName.set(name, (byName.get(name) ?? 0) + quantity);
  }
  return Array.from(byName, ([name, quantity]) => ({ name, quantity }));
}
