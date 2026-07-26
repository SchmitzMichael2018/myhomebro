import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TakeoffQuantitySummary } from "./TakeoffSessionPage.jsx";

describe("Takeoff review contract", () => {
  it("shows measured, waste, theoretical, purchase, excess, and price values separately", () => {
    const html = renderToStaticMarkup(<TakeoffQuantitySummary item={{
      lineage: { measured_quantity: "191.60", measurement_unit: "square_feet" },
      waste_quantity: "19.16", waste_percentage: "10",
      required_quantity: "210.76", theoretical_quantity: "9.409",
      purchase_quantity: "10", purchased_coverage: "224.00",
      excess_quantity: "13.24", selling_unit: "box",
      unit_price_snapshot: "67.18",
      product_snapshot: { price_basis: "per_selling_unit" },
    }} />);

    expect(html).toContain("Measured quantity");
    expect(html).toContain("Waste");
    expect(html).toContain("Theoretical purchase units");
    expect(html).toContain("Purchase quantity");
    expect(html).toContain("Excess coverage");
    expect(html).toContain("$67.18");
    expect(html.toLowerCase()).not.toContain("checkout");
    expect(html.toLowerCase()).not.toContain("order materials");
  });
});
