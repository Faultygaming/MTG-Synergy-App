import { describe, expect, it } from "vitest";
import { extractDeckId } from "./moxfield";

describe("extractDeckId", () => {
  it("extracts from a full https URL", () => {
    expect(extractDeckId("https://moxfield.com/decks/z4iIQoHd4ECI0GNv5H1u3g")).toBe(
      "z4iIQoHd4ECI0GNv5H1u3g",
    );
  });

  it("extracts from a www. URL", () => {
    expect(extractDeckId("https://www.moxfield.com/decks/abc123")).toBe("abc123");
  });

  it("accepts a bare id", () => {
    expect(extractDeckId("z4iIQoHd4ECI0GNv5H1u3g")).toBe("z4iIQoHd4ECI0GNv5H1u3g");
  });

  it("returns null for non-moxfield URLs", () => {
    expect(extractDeckId("https://archidekt.com/decks/12345")).toBeNull();
  });

  it("returns null for garbage", () => {
    expect(extractDeckId("not a url")).toBeNull();
  });
});
