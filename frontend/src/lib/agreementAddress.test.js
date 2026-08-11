import { describe, expect, it, vi } from "vitest";
import { lookupUsZip, normalizeUsPostalInput, parseFormattedUsAddress } from "./agreementAddress.js";
import { parseAddressComponentsFromPlace } from "../components/AddressAutocomplete.jsx";

describe("Agreement address helpers", () => {
  it("parses combined and comma-separated state/ZIP formats", () => {
    const expected = { address_line1: "123 Test Project Lane", address_line2: "", city: "San Antonio", state: "TX", postal_code: "78245" };
    expect(parseFormattedUsAddress("123 Test Project Lane, San Antonio, TX 78245")).toEqual(expected);
    expect(parseFormattedUsAddress("123 Test Project Lane, San Antonio, TX, 78245")).toEqual(expected);
  });
  it("keeps ambiguous addresses unstructured", () => {
    expect(parseFormattedUsAddress("New Construction Site, Somewhere")).toMatchObject({ address_line1: "New Construction Site, Somewhere", city: "", state: "", postal_code: "" });
  });
  it("preserves partial typing and supports ZIP+4", () => {
    expect(normalizeUsPostalInput("782")).toBe("782");
    expect(normalizeUsPostalInput("782451519")).toBe("78245-1519");
  });
  it("resolves a ZIP and treats lookup failure as non-blocking", async () => {
    const success = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ places: [{ "place name": "San Antonio", "state abbreviation": "TX" }] }) });
    expect(await lookupUsZip("78245", success)).toEqual({ city: "San Antonio", state: "TX", postal_code: "78245" });
    expect(await lookupUsZip("00000", vi.fn().mockResolvedValue({ ok: false }))).toBeNull();
  });
  it("maps autocomplete components by name, independent of ordering", () => {
    expect(parseAddressComponentsFromPlace({ address_components: [
      { long_name: "78245", types: ["postal_code"] },
      { short_name: "TX", long_name: "Texas", types: ["administrative_area_level_1"] },
      { long_name: "Test Project Lane", types: ["route"] },
      { long_name: "San Antonio", types: ["locality"] },
      { long_name: "123", types: ["street_number"] },
      { long_name: "Suite 4", types: ["subpremise"] },
    ] })).toMatchObject({ line1: "123 Test Project Lane", line2: "Suite 4", city: "San Antonio", state: "TX", postal_code: "78245" });
  });
});
