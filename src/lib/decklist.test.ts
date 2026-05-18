import { describe, expect, it } from "vitest";
import { parseDecklist } from "./decklist";

describe("parseDecklist", () => {
  it("parses 'N Card Name'", () => {
    expect(parseDecklist("4 Lightning Bolt")).toEqual([
      { name: "Lightning Bolt", quantity: 4 },
    ]);
  });

  it("parses 'Nx Card Name'", () => {
    expect(parseDecklist("4x Lightning Bolt")).toEqual([
      { name: "Lightning Bolt", quantity: 4 },
    ]);
  });

  it("defaults quantity to 1 when omitted", () => {
    expect(parseDecklist("Sol Ring")).toEqual([
      { name: "Sol Ring", quantity: 1 },
    ]);
  });

  it("strips set/collector suffixes", () => {
    expect(parseDecklist("1 Sol Ring (CMR) 309")).toEqual([
      { name: "Sol Ring", quantity: 1 },
    ]);
  });

  it("merges duplicates", () => {
    expect(parseDecklist("2 Forest\n3 Forest")).toEqual([
      { name: "Forest", quantity: 5 },
    ]);
  });

  it("skips comments and section headers", () => {
    const input = "// Mainboard\nSideboard\n1 Llanowar Elves\n# notes";
    expect(parseDecklist(input)).toEqual([
      { name: "Llanowar Elves", quantity: 1 },
    ]);
  });

  it("tolerates blank lines and stray whitespace", () => {
    expect(parseDecklist("\n  2   Forest  \n\n")).toEqual([
      { name: "Forest", quantity: 2 },
    ]);
  });

  // Used by /api/decks to normalize the commander input field, which
  // accepts any of: bare name, "1 Name", "1x Name", "1 Name (SET) 123".
  it("normalizes a single Moxfield-style commander line", () => {
    expect(parseDecklist("1 Hearthhull, the Worldseed")).toEqual([
      { name: "Hearthhull, the Worldseed", quantity: 1 },
    ]);
    expect(parseDecklist("1x Hearthhull, the Worldseed")).toEqual([
      { name: "Hearthhull, the Worldseed", quantity: 1 },
    ]);
    expect(parseDecklist("1 Hearthhull, the Worldseed (EOS) 145")).toEqual([
      { name: "Hearthhull, the Worldseed", quantity: 1 },
    ]);
  });
});
