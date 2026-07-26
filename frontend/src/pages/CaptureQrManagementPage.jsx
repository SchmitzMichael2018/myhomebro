import React, { useEffect, useState } from "react";
import { ArrowLeft, Copy, Download, ExternalLink, QrCode } from "lucide-react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";

import {
  actOnCaptureQrAsset,
  createCaptureQrAsset,
  downloadCaptureQr,
  getCaptureQrAnalytics,
  listCaptureQrAssets,
} from "../api/captures.js";
import { Button, Card, EmptyState, InlineAlert, LoadingSkeleton, MetricCard, WorkspacePageHeader } from "../components/ui";
import { isCaptureQrEnabled } from "../lib/captureFlags.js";

const TYPES = [
  "business_card", "truck", "trailer", "yard_sign", "flyer", "door_hanger",
  "home_show", "referral_partner", "social_media", "website", "custom",
];

export default function CaptureQrManagementPage() {
  const navigate = useNavigate();
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [label, setLabel] = useState("Business Card");
  const [campaign, setCampaign] = useState("");
  const [assetType, setAssetType] = useState("business_card");
  const [analytics, setAnalytics] = useState({});
  const [confirm, setConfirm] = useState(null);

  async function load() {
    setLoading(true);
    try {
      const response = await listCaptureQrAssets();
      setAssets(response.results || []);
      setError("");
    } catch (requestError) {
      setError(requestError?.response?.data?.detail || "QR assets could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);
  if (!isCaptureQrEnabled()) return null;

  async function create(event) {
    event.preventDefault();
    setBusy("create");
    try {
      await createCaptureQrAsset({
        label, campaign_key: campaign, asset_type: assetType, source_detail: assetType,
      });
      toast.success("QR asset created.");
      await load();
    } catch (requestError) {
      toast.error(requestError?.response?.data?.detail || "QR asset could not be created.");
    } finally {
      setBusy("");
    }
  }

  async function action(asset, name) {
    setBusy(`${asset.id}-${name}`);
    try {
      await actOnCaptureQrAsset(asset.id, name);
      toast.success(`QR asset ${name === "deactivate" ? "deactivated" : `${name}d`}.`);
      setConfirm(null);
      await load();
    } catch (requestError) {
      toast.error(requestError?.response?.data?.detail || "QR asset could not be updated.");
    } finally {
      setBusy("");
    }
  }

  async function copyLink(value) {
    await navigator.clipboard.writeText(value);
    toast.success("Public link copied.");
  }

  async function download(asset) {
    const blob = await downloadCaptureQr(asset.id);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${asset.label}-qr.svg`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function showAnalytics(asset) {
    const result = await getCaptureQrAnalytics(asset.id);
    setAnalytics((current) => ({ ...current, [asset.id]: result }));
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 overflow-x-clip p-4 sm:p-6 lg:p-8" data-testid="capture-qr-management">
      <WorkspacePageHeader
        theme="operational"
        title="Capture QR"
        subtitle="Create managed QR links that send project interest into Capture review."
        secondaryActions={<Button variant="secondary" theme="operational" startIcon={<ArrowLeft />} onClick={() => navigate("/app/capture")}>Back to Capture</Button>}
      />
      <Card theme="operational" padding="md">
        <h2 className="text-lg font-black">Create QR asset</h2>
        <form className="mt-4 grid gap-4 sm:grid-cols-3" onSubmit={create}>
          <label className="grid gap-1 text-sm font-bold">Label<input required value={label} onChange={(e) => setLabel(e.target.value)} className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3" /></label>
          <label className="grid gap-1 text-sm font-bold">Campaign<input value={campaign} onChange={(e) => setCampaign(e.target.value)} className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3" /></label>
          <label className="grid gap-1 text-sm font-bold">Asset type<select value={assetType} onChange={(e) => setAssetType(e.target.value)} className="min-h-11 rounded-xl border border-[var(--mhb-border-default)] bg-[var(--mhb-surface-inset)] px-3">{TYPES.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label>
          <Button theme="operational" loading={busy === "create"} type="submit" startIcon={<QrCode />}>Create QR</Button>
        </form>
      </Card>
      {loading ? <LoadingSkeleton theme="operational" variant="list" label="Loading QR assets" /> : null}
      {error ? <InlineAlert theme="operational" tone="danger">{error} <button className="underline" onClick={load}>Try again</button></InlineAlert> : null}
      {!loading && !error && !assets.length ? <EmptyState theme="operational" title="No QR assets yet" description="Create a Business Card QR to start." /> : null}
      <div className="grid gap-4">
        {assets.map((asset) => (
          <Card key={asset.id} theme="operational" padding="md">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <div className="min-w-0 flex-1"><h2 className="font-black">{asset.label}</h2><p className="text-sm text-[var(--mhb-text-muted)]">{asset.asset_type.replaceAll("_", " ")} · {asset.campaign_key || "No campaign"} · {asset.available ? "Active" : asset.revoked_at ? "Revoked" : "Inactive"}</p></div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" theme="operational" startIcon={<Copy />} onClick={() => copyLink(asset.public_url)}>Copy link</Button>
                <Button size="sm" variant="secondary" theme="operational" startIcon={<ExternalLink />} onClick={() => window.open(asset.public_url, "_blank", "noopener")}>Preview</Button>
                <Button size="sm" variant="secondary" theme="operational" startIcon={<Download />} onClick={() => download(asset)}>Download QR</Button>
                <Button size="sm" variant="secondary" theme="operational" onClick={() => action(asset, asset.active ? "deactivate" : "activate")}>{asset.active ? "Deactivate" : "Activate"}</Button>
                {!asset.revoked_at ? <Button size="sm" variant="secondary" theme="operational" onClick={() => setConfirm({ asset, action: "rotate" })}>Rotate</Button> : null}
                {!asset.revoked_at ? <Button size="sm" variant="danger" theme="operational" onClick={() => setConfirm({ asset, action: "revoke" })}>Revoke</Button> : null}
                <Button size="sm" variant="ghost" theme="operational" onClick={() => showAnalytics(asset)}>Analytics</Button>
              </div>
            </div>
            {analytics[asset.id] ? <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-6">{Object.entries(analytics[asset.id]).map(([key, value]) => <MetricCard key={key} theme="operational" label={key.replaceAll("_", " ")} value={value} />)}</div> : null}
          </Card>
        ))}
      </div>
      {confirm ? <div role="alertdialog" aria-modal="true" aria-labelledby="qr-confirm-title" className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"><Card theme="operational" padding="lg"><h2 id="qr-confirm-title" className="text-lg font-black">{confirm.action === "revoke" ? "Permanently revoke this token?" : "Rotate to a new token?"}</h2><p className="mt-2 text-sm">Existing submissions and attribution remain unchanged. The current public link will stop working.</p><div className="mt-4 flex justify-end gap-2"><Button variant="secondary" theme="operational" onClick={() => setConfirm(null)}>Cancel</Button><Button variant={confirm.action === "revoke" ? "danger" : "primary"} theme="operational" loading={busy === `${confirm.asset.id}-${confirm.action}`} onClick={() => action(confirm.asset, confirm.action)}>Confirm {confirm.action}</Button></div></Card></div> : null}
    </div>
  );
}
