import React, { useEffect, useState } from "react";
import { ArrowLeft, Calculator, FileSearch, PackageCheck } from "lucide-react";
import { Link, useParams } from "react-router-dom";

import { actOnTakeoff, getTakeoff, previewTakeoffEstimate, updateTakeoff } from "../api/captures.js";
import { Button, InlineAlert } from "../components/ui";

const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0));
const label = (value) => String(value || "").replaceAll("_", " ");

export function TakeoffQuantitySummary({ item }) {
  if (!item) return null;
  return (
    <div className="grid gap-2" data-testid="takeoff-quantity-summary">
      {[
        ["Measured quantity", item.lineage?.measured_quantity, item.lineage?.measurement_unit],
        ["Waste", item.waste_quantity, `${item.lineage?.measurement_unit} (${item.waste_percentage}%)`],
        ["Required coverage", item.required_quantity, item.lineage?.measurement_unit],
        ["Theoretical purchase units", item.theoretical_quantity, item.selling_unit],
        ["Purchase quantity", item.purchase_quantity, item.selling_unit],
        ["Purchased coverage", item.purchased_coverage, item.lineage?.measurement_unit],
        ["Excess coverage", item.excess_quantity, item.lineage?.measurement_unit],
        ["Price", money(item.unit_price_snapshot), `per ${label(item.product_snapshot?.price_basis)}`],
      ].map(([name, value, unit]) => (
        <div key={name} className="grid grid-cols-[1fr_auto] gap-3 rounded-xl bg-[var(--mhb-surface-inset)] p-3 text-sm">
          <span>{name}</span><strong className="text-right">{value} {label(unit)}</strong>
        </div>
      ))}
    </div>
  );
}

export default function TakeoffSessionPage() {
  const { takeoffId } = useParams();
  const [takeoff, setTakeoff] = useState(null);
  const [waste, setWaste] = useState("");
  const [markup, setMarkup] = useState("0");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  function load() {
    getTakeoff(takeoffId).then((data) => {
      setTakeoff(data);
      setWaste(data.items?.[0]?.waste_percentage || "0");
    }).catch((reason) => setError(reason?.response?.data?.detail || "Takeoff could not be loaded."));
  }
  useEffect(load, [takeoffId]);

  async function run(name, action) {
    setBusy(name);
    setError("");
    try {
      const data = await action();
      if (data?.id) setTakeoff(data);
      return data;
    } catch (reason) {
      setError(reason?.response?.data?.detail || "The takeoff could not be updated.");
    } finally {
      setBusy("");
    }
  }

  if (error && !takeoff) return <div className="p-4"><InlineAlert theme="operational" tone="danger">{error}</InlineAlert></div>;
  if (!takeoff) return <div className="p-6 text-[var(--mhb-text-muted)]">Loading takeoff…</div>;
  const item = takeoff.items?.[0];

  return (
    <main className="min-w-0 p-4 sm:p-6" data-testid="takeoff-session-page">
      <Link to={`/app/measurements/${takeoff.measurement_session}`} className="mb-4 inline-flex min-h-11 items-center gap-2 text-sm font-bold text-blue-400"><ArrowLeft size={17} /> Measurement session</Link>
      <header className="mb-5">
        <div className="text-xs font-bold uppercase tracking-widest text-[var(--mhb-text-muted)]">Intelligent Takeoff</div>
        <h1 className="mt-1 text-2xl font-bold">{takeoff.room_name} · {label(takeoff.trade_profile)}</h1>
        <p className="mt-1 text-sm text-[var(--mhb-text-secondary)]">{takeoff.project_title} · Version {takeoff.version} · {label(takeoff.status)}</p>
      </header>
      {takeoff.provisional ? <InlineAlert theme="operational" tone="warning">Provisional takeoff — source measurements need field verification. Confirmation and Estimate preview are blocked.</InlineAlert> : null}
      {error ? <div className="mt-3"><InlineAlert theme="operational" tone="danger">{error}</InlineAlert></div> : null}
      <div className="mt-5 grid min-w-0 gap-5 xl:grid-cols-[1.35fr_.65fr]">
        <section className="min-w-0 rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] p-4">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-bold"><Calculator size={19} /> Explainable calculation</h2>
          {item ? (
            <div className="grid gap-2">
              <TakeoffQuantitySummary item={item} />
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div className="rounded-xl border border-[var(--mhb-border-default)] p-3"><span className="block text-xs text-[var(--mhb-text-muted)]">Subtotal</span><strong>{money(item.subtotal)}</strong></div>
                <div className="rounded-xl border border-[var(--mhb-border-default)] p-3"><span className="block text-xs text-[var(--mhb-text-muted)]">Tax</span><strong>{money(item.tax)}</strong></div>
                <div className="rounded-xl border border-[var(--mhb-border-default)] p-3"><span className="block text-xs text-[var(--mhb-text-muted)]">Markup</span><strong>{money(item.markup)}</strong></div>
                <div className="rounded-xl border border-[var(--mhb-border-default)] p-3"><span className="block text-xs text-[var(--mhb-text-muted)]">Estimated total</span><strong>{money(item.final_estimated_cost)}</strong></div>
              </div>
              {item.warnings?.map((warning) => <InlineAlert key={warning} theme="operational" tone="warning">{warning}</InlineAlert>)}
            </div>
          ) : null}
        </section>
        <aside className="grid content-start gap-5">
          <section className="rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] p-4">
            <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><PackageCheck size={19} /> Product snapshot</h2>
            <dl className="grid gap-2 text-sm">
              <div><dt className="text-[var(--mhb-text-muted)]">Product</dt><dd className="font-bold">{item?.product_snapshot?.name}</dd></div>
              <div><dt className="text-[var(--mhb-text-muted)]">Supplier / SKU</dt><dd>{item?.product_snapshot?.supplier || "Not supplied"} · {item?.product_snapshot?.supplier_sku || "No SKU"}</dd></div>
              <div><dt className="text-[var(--mhb-text-muted)]">Price source</dt><dd>{item?.product_snapshot?.price_source}</dd></div>
              <div><dt className="text-[var(--mhb-text-muted)]">Effective date</dt><dd>{item?.product_snapshot?.price_effective_date}</dd></div>
              <div><dt className="text-[var(--mhb-text-muted)]">Coverage</dt><dd>{item?.package_coverage} {label(item?.product_snapshot?.coverage_unit)} / {label(item?.selling_unit)}</dd></div>
            </dl>
          </section>
          <section className="rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] p-4">
            <h2 className="mb-3 text-lg font-bold">Review assumptions</h2>
            <label className="grid gap-1 text-sm font-bold">Waste percentage<input value={waste} inputMode="decimal" onChange={(event) => setWaste(event.target.value)} className="min-h-12 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3" /></label>
            <label className="mt-3 grid gap-1 text-sm font-bold">Markup percentage<input value={markup} inputMode="decimal" onChange={(event) => setMarkup(event.target.value)} className="min-h-12 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3" /></label>
            <Button type="button" variant="secondary" theme="operational" loading={busy === "recalculate"} onClick={() => run("recalculate", () => updateTakeoff(takeoff.id, { expected_version: takeoff.version, waste_percentage: waste, markup_rate: markup }))} className="mt-3 w-full">Recalculate server-side</Button>
          </section>
        </aside>
      </div>
      <section className="mt-5 rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] p-4">
        <h2 className="mb-3 flex items-center gap-2 text-lg font-bold"><FileSearch size={19} /> Estimate handoff</h2>
        <p className="mb-3 text-sm text-[var(--mhb-text-secondary)]">Preview proposed material rows without changing the Estimate.</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" theme="operational" loading={busy === "confirm"} disabled={takeoff.provisional || takeoff.status === "confirmed"} onClick={() => run("confirm", () => actOnTakeoff(takeoff.id, "confirm", { expected_version: takeoff.version }))}>Confirm takeoff</Button>
          <Button type="button" variant="secondary" theme="operational" loading={busy === "preview"} disabled={takeoff.status !== "confirmed"} onClick={() => run("preview", async () => { const data = await previewTakeoffEstimate(takeoff.id); setPreview(data); return data; })}>Preview Estimate rows</Button>
        </div>
        {preview ? <div className="mt-4 grid gap-2">{preview.line_items.map((row) => <div key={row.source_takeoff_item_id} className="rounded-xl bg-[var(--mhb-surface-inset)] p-3 text-sm"><strong>{row.description}</strong><div>{row.quantity} {label(row.unit)} × {money(row.unit_cost)} = {money(row.subtotal)}</div></div>)}<InlineAlert theme="operational" tone="info">Preview only. No Estimate records were created or changed.</InlineAlert></div> : null}
      </section>
      <section className="mt-5 rounded-2xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-card)] p-4">
        <h2 className="mb-3 text-lg font-bold">History</h2>
        <ol className="grid gap-2 text-sm">{takeoff.events.map((event) => <li key={event.id}><strong>{label(event.event_type)}</strong> · v{event.session_version} · {event.actor_name} · {new Date(event.created_at).toLocaleString()}</li>)}</ol>
      </section>
    </main>
  );
}
