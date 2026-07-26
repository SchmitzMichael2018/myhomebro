import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { createMaterial, createTakeoff, listMaterials } from "../../api/captures.js";
import { Button, InlineAlert, Modal } from "../ui";

const PROFILE_RESULTS = {
  flooring: ["net_area", "gross_area"],
  paint: ["net_area", "gross_area"],
  tile: ["net_area", "gross_area", "opening_area"],
  drywall: ["net_area", "gross_area"],
  linear_material: ["total_linear_length", "perimeter"],
  concrete: ["volume"],
};

export default function CreateTakeoffModal({ measurement, visible, onClose }) {
  const navigate = useNavigate();
  const [materials, setMaterials] = useState([]);
  const [profile, setProfile] = useState("flooring");
  const [materialId, setMaterialId] = useState("");
  const [resultId, setResultId] = useState("");
  const [waste, setWaste] = useState("10");
  const [coats, setCoats] = useState("1");
  const [acknowledge, setAcknowledge] = useState(false);
  const [custom, setCustom] = useState(false);
  const [product, setProduct] = useState({
    name: "", category: "flooring", unit_price: "", price_basis: "per_selling_unit",
    selling_unit: "box", coverage_quantity: "", coverage_unit: "square_feet",
    package_quantity: "1", waste_default: "10", markup_default: "0",
    price_source: "Manual entry", price_effective_date: new Date().toISOString().slice(0, 10),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const eligibleResults = useMemo(
    () => (measurement?.calculated_results || []).filter((row) => PROFILE_RESULTS[profile]?.includes(row.result_type)),
    [measurement, profile],
  );
  const selectedResult = eligibleResults.find((row) => String(row.id) === String(resultId)) || eligibleResults[0];
  const provisional = selectedResult && !["verified", "confirmed"].includes(selectedResult.verification_status);

  useEffect(() => {
    if (!visible) return;
    listMaterials().then(setMaterials).catch(() => setError("Material Library could not be loaded."));
  }, [visible]);
  useEffect(() => setResultId(eligibleResults[0]?.id || ""), [profile, eligibleResults]);
  useEffect(() => {
    setProduct((current) => ({
      ...current,
      coverage_unit: profile === "linear_material" ? "linear_feet" : profile === "concrete" ? "cubic_feet" : "square_feet",
      category: profile,
    }));
  }, [profile]);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      let selectedMaterialId = materialId;
      if (custom) {
        const saved = await createMaterial({ ...product, category: profile });
        selectedMaterialId = saved.id;
      }
      const takeoff = await createTakeoff({
        measurement_session_id: measurement.id,
        measurement_result_id: Number(resultId || eligibleResults[0]?.id),
        trade_profile: profile,
        material_id: Number(selectedMaterialId),
        waste_percentage: waste,
        coats,
        acknowledge_provisional: acknowledge,
      });
      navigate(`/app/takeoffs/${takeoff.id}`);
    } catch (reason) {
      const data = reason?.response?.data;
      setError(data?.detail || Object.values(data || {})?.flat()?.[0] || "Takeoff could not be created.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} title="Create Takeoff" onClose={onClose} testId="create-takeoff-modal" containerClassName="h-[100dvh] max-h-[100dvh] sm:h-auto sm:max-h-[90vh] sm:max-w-2xl" bodyClassName="max-h-[calc(100dvh-4rem)] overflow-y-auto p-4">
      <form onSubmit={submit} className="grid min-w-0 gap-4 pb-16 sm:pb-0">
        <InlineAlert theme="operational" tone="info">
          Measurement defines the space. Coverage and packaging define what must be purchased. No Estimate will be changed.
        </InlineAlert>
        <label className="grid gap-1 text-sm font-bold">Trade profile
          <select value={profile} onChange={(event) => setProfile(event.target.value)} className="min-h-12 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3">
            {Object.keys(PROFILE_RESULTS).map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm font-bold">Measurement result
          <select value={resultId} onChange={(event) => setResultId(event.target.value)} required className="min-h-12 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3">
            {eligibleResults.map((row) => <option key={row.id} value={row.id}>{row.label} · {row.display_value} {row.display_unit.replaceAll("_", " ")} · {row.verification_status.replaceAll("_", " ")}</option>)}
          </select>
        </label>
        {!eligibleResults.length ? <InlineAlert theme="operational" tone="warning">This session does not have a compatible calculated result for that trade.</InlineAlert> : null}
        <label className="flex min-h-11 items-center gap-2 text-sm font-bold"><input type="checkbox" checked={custom} onChange={(event) => setCustom(event.target.checked)} /> Add a custom Material Library item</label>
        {!custom ? (
          <label className="grid gap-1 text-sm font-bold">Material
            <select value={materialId} onChange={(event) => setMaterialId(event.target.value)} required className="min-h-12 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3">
              <option value="">Choose a material</option>
              {materials.filter((row) => row.coverage_unit === (profile === "linear_material" ? "linear_feet" : profile === "concrete" ? "cubic_feet" : "square_feet")).map((row) => <option key={row.id} value={row.id}>{row.name} · ${row.unit_price} / {row.selling_unit.replaceAll("_", " ")}</option>)}
            </select>
          </label>
        ) : (
          <section className="grid grid-cols-1 gap-3 rounded-xl border border-[var(--mhb-border-default)] p-3 sm:grid-cols-2">
            {[
              ["name", "Product name"], ["unit_price", "Unit price"],
              ["coverage_quantity", "Coverage per selling unit"], ["price_source", "Price source"],
              ["price_effective_date", "Price effective date"],
            ].map(([key, label]) => <label key={key} className="grid gap-1 text-xs font-bold">{label}<input type={key === "price_effective_date" ? "date" : "text"} inputMode={["unit_price", "coverage_quantity"].includes(key) ? "decimal" : undefined} value={product[key]} onChange={(event) => setProduct((current) => ({ ...current, [key]: event.target.value }))} required className="min-h-11 min-w-0 rounded-lg border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-2" /></label>)}
            <label className="grid gap-1 text-xs font-bold">Selling unit<select value={product.selling_unit} onChange={(event) => setProduct((current) => ({ ...current, selling_unit: event.target.value }))} className="min-h-11 rounded-lg border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-2">{["box", "case", "sheet", "panel", "roll", "bag", "gallon", "linear_foot", "square_foot", "cubic_yard", "each"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
          </section>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm font-bold">Waste percentage<input inputMode="decimal" value={waste} onChange={(event) => setWaste(event.target.value)} className="min-h-12 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3" /></label>
          {profile === "paint" ? <label className="grid gap-1 text-sm font-bold">Coats<input inputMode="numeric" value={coats} onChange={(event) => setCoats(event.target.value)} className="min-h-12 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3" /></label> : null}
        </div>
        {provisional ? <InlineAlert theme="operational" tone="warning">Needs field verification. This takeoff will remain provisional and cannot be confirmed or handed off.</InlineAlert> : null}
        {provisional ? <label className="flex min-h-11 items-start gap-2 text-sm"><input type="checkbox" checked={acknowledge} onChange={(event) => setAcknowledge(event.target.checked)} className="mt-1" /> I understand this measurement is not verified and will verify it before contractual use.</label> : null}
        {error ? <InlineAlert theme="operational" tone="danger">{error}</InlineAlert> : null}
        <div className="sticky bottom-0 -mx-4 flex justify-end gap-2 border-t border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card-elevated)] p-4 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0">
          <Button type="button" variant="secondary" theme="operational" onClick={onClose}>Cancel</Button>
          <Button type="submit" theme="operational" loading={busy} disabled={!eligibleResults.length || (!custom && !materialId) || (provisional && !acknowledge)}>Calculate takeoff</Button>
        </div>
      </form>
    </Modal>
  );
}
