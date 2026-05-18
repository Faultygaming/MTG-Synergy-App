import { describe, expect, it } from "vitest";
import {
  COMMANDER_PRESETS,
  detectPreset,
  isSamePreset,
} from "./presets";
import type { CommanderRulesConfig } from "./config";
import { DEFAULT_CONFIG } from "./rules";

describe("presets", () => {
  it("strict preset matches the engine default", () => {
    const strict = COMMANDER_PRESETS.find((p) => p.id === "strict")!;
    expect(isSamePreset(strict.config, DEFAULT_CONFIG)).toBe(true);
  });

  it("every preset has a unique id and config", () => {
    const ids = new Set(COMMANDER_PRESETS.map((p) => p.id));
    expect(ids.size).toBe(COMMANDER_PRESETS.length);
    for (let i = 0; i < COMMANDER_PRESETS.length; i++) {
      for (let j = i + 1; j < COMMANDER_PRESETS.length; j++) {
        expect(isSamePreset(COMMANDER_PRESETS[i].config, COMMANDER_PRESETS[j].config)).toBe(false);
      }
    }
  });

  it("detectPreset round-trips every preset config", () => {
    for (const p of COMMANDER_PRESETS) {
      expect(detectPreset(p.config)).toBe(p.id);
    }
  });

  it("detectPreset returns null for a config that doesn't match any preset", () => {
    const custom: CommanderRulesConfig = {
      deckSize: "block",
      singleton: "off", // off matches no preset
      colorIdentity: "block",
      banlist: "block",
      commanderLegality: "block",
      globalMode: "strict",
    };
    expect(detectPreset(custom)).toBeNull();
  });
});
