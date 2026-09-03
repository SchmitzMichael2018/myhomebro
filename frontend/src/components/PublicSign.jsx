// frontend/src/components/PublicSign.jsx
// Customer-facing review / sign / fund page for tokenized agreements.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import toast from "react-hot-toast";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";

import api from "../api";
import SignatureModal from "./SignatureModal";
import { getStripePublishableKey } from "../lib/runtimeConfig";
import { ProjectModeBadge } from "./projectMode.jsx";

const STRIPE_PUBLISHABLE_KEY = getStripePublishableKey();
const stripePromise = STRIPE_PUBLISHABLE_KEY ? loadStripe(STRIPE_PUBLISHABLE_KEY) : null;

function money(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return "$0.00";
  return `$${num.toFixed(2)}`;
}

function parseFundingToken(url) {
  if (!url || typeof url !== "string") return "";
  const trimmed = url.replace(/\/+$/, "");
  return trimmed.split("/").pop() || "";
}

function FundingPaymentForm({ clientSecret, amountLabel, onPaid }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [alreadyPaid, setAlreadyPaid] = useState(false);

  useEffect(() => {
    if (!stripe || !clientSecret) return;
    stripe.retrievePaymentIntent(clientSecret).then((res) => {
      if (res?.paymentIntent?.status === "succeeded") {
        setAlreadyPaid(true);
        onPaid?.();
      }
    });
  }, [stripe, clientSecret]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!stripe || !elements || submitting) return;

    setSubmitting(true);
    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
    });

    if (error) {
      toast.error(error.message || "Payment failed");
      setSubmitting(false);
      return;
    }

    if (paymentIntent?.status === "succeeded") {
      setAlreadyPaid(true);
      onPaid?.();
      toast.success("Deposit funded");
    }

    setSubmitting(false);
  };

  if (alreadyPaid) {
    return (
      <div
        className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-800"
        data-testid="public-agreement-payment-success"
      >
        Deposit funding completed.
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement options={{ layout: "tabs" }} />
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-2xl bg-emerald-600 px-4 py-3 font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {submitting ? "Processing…" : `Pay ${amountLabel}`}
      </button>
      <div className="text-xs text-slate-500">
        Payments are processed securely by Stripe.
      </div>
    </form>
  );
}

function PublicFundingCheckout({ fundingToken, agreementTitle, onPaid }) {
  const [info, setInfo] = useState(null);
  const [clientSecret, setClientSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fundingUrl = fundingToken ? `/public-fund/${fundingToken}` : "";

  useEffect(() => {
    if (!fundingToken) {
      setInfo(null);
      setClientSecret("");
      setError("");
      return;
    }

    let mounted = true;
    setLoading(true);
    setError("");
    setInfo(null);
    setClientSecret("");

    api
      .get(`/projects/funding/public_fund/?token=${encodeURIComponent(fundingToken)}`)
      .then(({ data }) => {
        if (!mounted) return;
        setInfo(data);
      })
      .catch((err) => {
        if (!mounted) return;
        const msg =
          err?.response?.data?.detail ||
          err?.response?.data?.error ||
          "Unable to load deposit details.";
        setError(String(msg));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, [fundingToken]);

  const remaining = info?.remaining_to_fund != null ? Number(info.remaining_to_fund) : NaN;
  const milestoneEscrowTotal = Number(info?.milestone_escrow_total || 0);
  const incidentalsReserve = Number(info?.incidentals_reserve || 0);

  useEffect(() => {
    if (!fundingToken || !info) return;
    if (!Number.isFinite(remaining) || remaining <= 0) return;

    let mounted = true;
    setClientSecret("");
    api
      .post("/projects/funding/create_payment_intent/", { token: fundingToken })
      .then(({ data }) => {
        if (!mounted) return;
        if (data?.already_paid) {
          setClientSecret("");
          onPaid?.();
          return;
        }
        setClientSecret(data?.client_secret || "");
      })
      .catch((err) => {
        if (!mounted) return;
        const msg =
          err?.response?.data?.detail ||
          err?.response?.data?.error ||
          "Unable to start payment.";
        setError(String(msg));
      });

    return () => {
      mounted = false;
    };
  }, [fundingToken, info, remaining]);

  const elementsOptions = useMemo(() => {
    if (!clientSecret) return null;
    return {
      clientSecret,
      appearance: {
        theme: "stripe",
        variables: {
          fontFamily: "Inter, system-ui, -apple-system, Segoe UI, Roboto, Arial",
          fontSizeBase: "15px",
          colorPrimary: "#10B981",
          colorText: "#0F172A",
          colorDanger: "#DC2626",
          colorBackground: "#FFFFFF",
          borderRadius: "16px",
          spacingUnit: "6px",
        },
      },
    };
  }, [clientSecret]);

  if (!fundingToken) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-600">
        Sign the agreement to unlock deposit funding.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        Loading deposit details…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
        {error}
        {fundingUrl ? (
          <a
            href={fundingUrl}
            className="mt-3 inline-flex rounded-full bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white"
          >
            Open secure funding page
          </a>
        ) : null}
      </div>
    );
  }

  if (!Number.isFinite(remaining)) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        Preparing your deposit step…
      </div>
    );
  }

  if (remaining <= 0) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
        {agreementTitle ? `${agreementTitle} is fully funded.` : "This agreement is fully funded."}
      </div>
    );
  }

  if (!stripePromise) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        Stripe is not configured in this environment. Open the secure funding page to complete payment.
      </div>
    );
  }

  if (!clientSecret || !elementsOptions) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        Initializing secure payment…
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="public-agreement-funding-panel">
      <div className="mb-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Deposit funding</div>
        <div className="mt-1 text-sm text-slate-600">
          Fund the escrow deposit for this agreement.
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-2xl bg-slate-50 p-3">
          <div className="text-xs text-slate-500">Milestone escrow total</div>
          <div className="text-lg font-bold text-slate-900">{money(milestoneEscrowTotal)}</div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <div className="text-xs text-slate-500">Incidentals Reserve</div>
          <div className="text-lg font-bold text-slate-900">{money(incidentalsReserve)}</div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <div className="text-xs text-slate-500">Amount due now</div>
          <div className="text-lg font-bold text-slate-900">{money(remaining)}</div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <div className="text-xs text-slate-500">Funded so far</div>
          <div className="text-lg font-bold text-slate-900">{money(info?.escrow_funded_amount)}</div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <div className="text-xs text-slate-500">Total escrow required</div>
          <div className="text-lg font-bold text-slate-900">{money(info?.total_required)}</div>
        </div>
      </div>

      <Elements stripe={stripePromise} options={elementsOptions}>
        <FundingPaymentForm
          clientSecret={clientSecret}
          amountLabel={money(remaining)}
          onPaid={onPaid}
        />
      </Elements>
    </div>
  );
}

export default function PublicSign() {
  const { token } = useParams();

  const [loading, setLoading] = useState(true);
  const [agreement, setAgreement] = useState(null);
  const [error, setError] = useState("");
  const [isSignOpen, setIsSignOpen] = useState(false);
  const [pdfReviewed, setPdfReviewed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const loadAgreement = useCallback(async () => {
    if (!token) {
      setError("Missing signing token.");
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const { data } = await api.get(
        `/projects/agreements/public_sign/?token=${encodeURIComponent(token)}`
      );
      setAgreement(data);
      setError("");
    } catch (err) {
      console.error(err);
      const msg =
        err?.response?.data?.detail ||
        "Unable to load this agreement. The link may have expired.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadAgreement();
  }, [loadAgreement, reloadKey]);

  const isFullySigned =
    agreement?.is_fully_signed === true ||
    String(agreement?.status || "").toLowerCase() === "signed";

  const contractorRating = agreement?.contractor_rating || {};
  const projectTitle = agreement?.project_title || agreement?.title || "Agreement";
  const contractorEmail = agreement?.contractor_email || "";
  const projectDashboardUrl = agreement?.project_dashboard_url || "";
  const fundingToken = agreement?.funding_token || parseFundingToken(agreement?.public_fund_url || "");
  const paymentMode = String(agreement?.payment_mode || "escrow").trim().toLowerCase();
  const usesEscrow = paymentMode === "escrow";
  const contractAmount = Number(agreement?.contract_amount ?? agreement?.total_cost ?? 0);
  const contingencyReserve = Number(agreement?.contingency_reserve ?? agreement?.incidentals_reserve_amount ?? 0);
  const totalEscrowRequired = Number(
    agreement?.total_escrow_required ?? contractAmount + contingencyReserve
  );

  const handleSigned = (updated) => {
    const fundingUrl =
      updated?.funding?.public_fund_url ||
      updated?.public_fund_url ||
      "";
    const nextToken = parseFundingToken(fundingUrl);
    if (nextToken) {
      setAgreement((current) => ({
        ...(current || {}),
        funding_token: nextToken,
        public_fund_url: fundingUrl,
      }));
    }
    setIsSignOpen(false);
    setReloadKey((v) => v + 1);
  };

  const askQuestionHref = contractorEmail
    ? `mailto:${contractorEmail}?subject=${encodeURIComponent(`Question about ${projectTitle}`)}`
    : "#terms";

  const handleReviewPdf = () => {
    if (!agreement?.pdf_url) {
      toast.error("The agreement PDF is not available yet.");
      return;
    }
    setPdfReviewed(true);
    window.open(agreement.pdf_url, "_blank", "noopener,noreferrer");
  };

  const handleDownloadPdf = () => {
    if (!agreement?.pdf_url) {
      toast.error("The agreement PDF is not available yet.");
      return;
    }
    setPdfReviewed(true);
    const link = document.createElement("a");
    link.href = agreement.pdf_url;
    link.download = `${projectTitle.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "agreement"}.pdf`;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const openSignature = () => {
    if (!pdfReviewed) {
      toast.error("Please open or download the agreement PDF before signing.");
      return;
    }
    setIsSignOpen(true);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 pb-24 lg:pb-8">
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 lg:px-6">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-[0.24em] text-slate-500">
              MyHomeBro
            </div>
            <div className="truncate text-sm font-semibold text-slate-900">
              Review & Sign Agreement
            </div>
          </div>
          <div className="ml-auto text-right text-xs text-slate-500">
            <div>{agreement?.contractor_name || "Your contractor"}</div>
            {contractorRating?.review_count > 0 ? (
              <div className="font-medium text-amber-600">
                {contractorRating.average_rating?.toFixed?.(2) || contractorRating.average_rating} rating
              </div>
            ) : (
              <div className="font-medium text-slate-500">New on MyHomeBro</div>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-4 lg:px-6">
        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            {error}
          </div>
        ) : null}

        {loading && !agreement ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600">
            Loading agreement…
          </div>
        ) : agreement ? (
          <>
            <section className="mb-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="public-agreement-hero">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Agreement from {agreement.contractor_name || "your contractor"}
              </div>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">{projectTitle}</h1>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">
                  {usesEscrow ? "Escrow protected" : "Direct pay"}
                </span>
                <ProjectModeBadge mode={agreement.project_mode} dataTestId="public-agreement-project-mode-badge" />
                <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-800">
                  {agreement.status_label || (isFullySigned ? "Signed" : "Awaiting your signature")}
                </span>
              </div>
            </section>

            {agreement.preview ? (
              <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Preview mode is active. This profile is not yet public, but you can still review the agreement.
              </div>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.65fr)_minmax(320px,0.75fr)]">
              <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm" data-testid="public-agreement-pdf-review">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Legal agreement</div>
                    <div className="mt-1 text-lg font-bold text-slate-900">Review the PDF before signing</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={handleReviewPdf} className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white" data-testid="public-agreement-open-pdf">Open PDF</button>
                    <button type="button" onClick={handleDownloadPdf} className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700" data-testid="public-agreement-download-pdf">Download PDF</button>
                  </div>
                </div>
                {agreement.pdf_url ? (
                  <iframe title="Agreement PDF" src={agreement.pdf_url} className="mt-4 h-[72vh] min-h-[620px] w-full rounded-2xl border border-slate-200 bg-slate-100" />
                ) : (
                  <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-5 text-sm text-rose-800">The agreement PDF is not available. Please ask the contractor to regenerate it before signing.</div>
                )}
              </section>

              <aside className="space-y-4 lg:sticky lg:top-20 self-start">
                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm" data-testid="public-agreement-financial-summary">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Agreement summary</div>
                  <dl className="mt-4 space-y-3 text-sm">
                    <div className="flex justify-between gap-4"><dt className="text-slate-600">Payment protection</dt><dd className="font-semibold text-slate-900">{usesEscrow ? "Escrow" : "Direct Pay"}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-slate-600">Contract amount</dt><dd className="font-semibold text-slate-900">{money(contractAmount)}</dd></div>
                    <div className="flex justify-between gap-4"><dt className="text-slate-600">Contingency reserve</dt><dd className="font-semibold text-slate-900">{money(contingencyReserve)}</dd></div>
                    {usesEscrow ? <div className="flex justify-between gap-4 border-t border-slate-200 pt-3"><dt className="font-semibold text-slate-900">Total escrow funding</dt><dd className="font-bold text-slate-900">{money(totalEscrowRequired)}</dd></div> : null}
                  </dl>
                  {contingencyReserve > 0 ? <p className="mt-4 rounded-2xl bg-amber-50 p-3 text-xs leading-5 text-amber-900">The contingency reserve is held separately from milestone payments and is used only for documented, approved unforeseen work.</p> : null}
                </section>

                {!isFullySigned ? (
                  <section className="rounded-3xl border border-sky-200 bg-sky-50 p-5 shadow-sm" data-testid="public-agreement-sign-action">
                    <div className="text-lg font-bold text-slate-900">Ready to sign?</div>
                    <p className="mt-2 text-sm leading-6 text-slate-700">Open or download the PDF first. Your signature applies to that agreement.</p>
                    <button type="button" onClick={openSignature} disabled={!agreement.pdf_url || !pdfReviewed} className="mt-4 w-full rounded-full bg-sky-600 px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50" data-testid="public-agreement-accept-sign">Accept & Sign</button>
                    {!pdfReviewed ? <div className="mt-2 text-center text-xs text-slate-600">PDF review required before signing</div> : null}
                    <a href={askQuestionHref} className="mt-3 block text-center text-sm font-semibold text-sky-800">Ask the contractor a question</a>
                  </section>
                ) : (
                  <section className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm" data-testid="public-agreement-confirmation">
                    <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Complete</div>
                    <div className="mt-1 text-lg font-bold text-emerald-900">Agreement signed successfully</div>
                    <p className="mt-2 text-sm leading-6 text-emerald-800">Your signed agreement is on file. Continue to the next project step below.</p>
                  </section>
                )}

                {isFullySigned && usesEscrow ? (
                  <div data-testid="public-agreement-funding-section">
                    <PublicFundingCheckout fundingToken={fundingToken} agreementTitle={projectTitle} onPaid={() => setReloadKey((v) => v + 1)} />
                  </div>
                ) : null}

                {isFullySigned && !usesEscrow ? (
                  <div className="rounded-3xl border border-slate-200 bg-white p-5 text-sm text-slate-700 shadow-sm">Your contractor will send payment requests according to the signed agreement.</div>
                ) : null}

                {isFullySigned && projectDashboardUrl ? (
                  <a href={projectDashboardUrl} className="block rounded-full bg-slate-900 px-4 py-3 text-center text-sm font-semibold text-white" data-testid="public-agreement-open-project-dashboard">Open Project Dashboard</a>
                ) : null}
              </aside>
            </div>

            {!isFullySigned ? <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
              <div className="mx-auto flex max-w-7xl gap-2">
                <button
                  type="button"
                  onClick={openSignature}
                  disabled={!agreement.pdf_url || !pdfReviewed}
                  className="flex-1 rounded-full bg-sky-600 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Accept & Sign
                </button>
                <a
                  href={askQuestionHref}
                  className="flex-1 rounded-full border border-slate-300 bg-white px-4 py-3 text-center text-sm font-semibold text-slate-700"
                >
                  Ask Question
                </a>
              </div>
            </div> : null}
          </>
        ) : null}
      </main>

      <SignatureModal
        isOpen={isSignOpen}
        onClose={() => setIsSignOpen(false)}
        agreement={
          agreement || {
            id: null,
            title: "Agreement",
            project_title: "Agreement",
          }
        }
        signingRole="homeowner"
        token={token}
        defaultName={agreement?.homeowner_name || ""}
        agreementReviewed={pdfReviewed}
        onOpenAgreementPdf={handleReviewPdf}
        onDownloadAgreementPdf={handleDownloadPdf}
        onSigned={handleSigned}
      />
    </div>
  );
}
