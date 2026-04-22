// frontend/src/components/PublicSign.jsx
// Customer-facing review / sign / fund page for tokenized agreements.

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useLocation } from "react-router-dom";
import toast from "react-hot-toast";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";

import api from "../api";
import SignatureModal from "./SignatureModal";
import { getStripePublishableKey } from "../lib/runtimeConfig";

const STRIPE_PUBLISHABLE_KEY = getStripePublishableKey();
const stripePromise = STRIPE_PUBLISHABLE_KEY ? loadStripe(STRIPE_PUBLISHABLE_KEY) : null;

function useQuery() {
  return new URLSearchParams(useLocation().search);
}

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

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-slate-50 p-3">
          <div className="text-xs text-slate-500">Amount due now</div>
          <div className="text-lg font-bold text-slate-900">{money(remaining)}</div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <div className="text-xs text-slate-500">Funded so far</div>
          <div className="text-lg font-bold text-slate-900">{money(info?.escrow_funded_amount)}</div>
        </div>
        <div className="rounded-2xl bg-slate-50 p-3">
          <div className="text-xs text-slate-500">Total required</div>
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
  const query = useQuery();

  const [loading, setLoading] = useState(true);
  const [agreement, setAgreement] = useState(null);
  const [error, setError] = useState("");
  const [isSignOpen, setIsSignOpen] = useState(false);
  const [lastSignResponse, setLastSignResponse] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  const modeFinal = (query.get("mode") || "").toLowerCase() === "final";

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
  const termsText =
    agreement?.terms_of_service_snapshot ||
    agreement?.terms_text ||
    agreement?.terms ||
    "";
  const projectTitle = agreement?.project_title || agreement?.title || "Agreement";
  const contractorEmail = agreement?.contractor_email || "";
  const fundingToken = agreement?.funding_token || parseFundingToken(agreement?.public_fund_url || "");

  const fundingSectionTitle = isFullySigned ? "Deposit Funding" : "Deposit Step";

  const handleSigned = (updated) => {
    setLastSignResponse(updated || null);
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

  const milestoneRows = Array.isArray(agreement?.milestones)
    ? agreement.milestones
    : [];
  const photoRows = Array.isArray(agreement?.attachments)
    ? agreement.attachments
    : [];

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
            <section
              className="mb-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm"
              data-testid="public-agreement-hero"
            >
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {agreement.contractor_name || "Contractor"}
                  </div>
                  <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-900">
                    {projectTitle}
                  </h1>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                    {contractorRating?.review_count > 0 ? (
                      <span className="inline-flex items-center rounded-full bg-amber-50 px-3 py-1 text-amber-700">
                        ★ {contractorRating.average_rating?.toFixed?.(2) || contractorRating.average_rating} • {contractorRating.review_count} verified reviews
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-slate-600">
                        New on MyHomeBro
                      </span>
                    )}
                    <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1">
                      {agreement.payment_mode === "escrow" ? "Escrow protected" : "Direct pay"}
                    </span>
                    {agreement.status ? (
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-3 py-1 capitalize">
                        {String(agreement.status).replaceAll("_", " ")}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setIsSignOpen(true)}
                    className="inline-flex items-center justify-center rounded-full bg-sky-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-500"
                    data-testid="public-agreement-accept-sign"
                  >
                    Accept & Sign
                  </button>
                  <a
                    href={askQuestionHref}
                    className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Ask Question
                  </a>
                </div>
              </div>
            </section>

            {agreement.preview ? (
              <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Preview mode is active. This profile is not yet public, but you can still review the agreement.
              </div>
            ) : null}

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(340px,0.9fr)]">
              <div className="space-y-4">
                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm" id="terms">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Project Summary
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-700">
                    {agreement.project_summary || agreement.scope_summary || agreement.description || "Project details will be finalized in the agreement."}
                  </p>
                </section>

                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Pricing
                  </div>
                  <div className="mt-3 grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl bg-slate-50 p-3">
                      <div className="text-xs text-slate-500">Total cost</div>
                      <div className="mt-1 text-xl font-bold text-slate-900">
                        {money(agreement.total_cost || agreement.escrow_total || 0)}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-3">
                      <div className="text-xs text-slate-500">Milestones</div>
                      <div className="mt-1 text-xl font-bold text-slate-900">
                        {milestoneRows.length}
                      </div>
                    </div>
                    <div className="rounded-2xl bg-slate-50 p-3">
                      <div className="text-xs text-slate-500">Escrow</div>
                      <div className="mt-1 text-xl font-bold text-slate-900">
                        {agreement.payment_mode === "escrow" ? "Protected" : "Not used"}
                      </div>
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-600">
                    {agreement.payment_mode === "escrow"
                      ? "We hold deposit funds securely, then release payments as milestones are approved."
                      : "This agreement uses direct pay instead of escrow funding."}
                  </p>
                  <div className="mt-4 space-y-2">
                    {milestoneRows.map((milestone, index) => (
                      <div
                        key={milestone.id || `${milestone.title}-${index}`}
                        className="flex items-center justify-between rounded-2xl border border-slate-200 px-4 py-3"
                      >
                        <div>
                          <div className="font-medium text-slate-900">{milestone.title}</div>
                          <div className="text-xs text-slate-500">{milestone.description || "Milestone phase"}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-semibold text-slate-900">{money(milestone.amount)}</div>
                          <div className="text-xs text-slate-500">Phase {milestone.order || index + 1}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Photos
                  </div>
                  {photoRows.length ? (
                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {photoRows.map((photo) => (
                        <a
                          key={photo.id}
                          href={photo.url}
                          target="_blank"
                          rel="noreferrer"
                          className="group overflow-hidden rounded-2xl border border-slate-200 bg-slate-50"
                        >
                          <div className="aspect-square bg-slate-100">
                            {photo.url ? (
                              <img
                                src={photo.url}
                                alt={photo.title || "Agreement attachment"}
                                className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                              />
                            ) : (
                              <div className="flex h-full items-center justify-center text-xs text-slate-500">
                                Attachment
                              </div>
                            )}
                          </div>
                          <div className="px-3 py-2">
                            <div className="truncate text-sm font-medium text-slate-900">{photo.title}</div>
                            <div className="text-xs text-slate-500">{photo.category}</div>
                          </div>
                        </a>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                      No project photos were attached yet.
                    </div>
                  )}
                </section>

                <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Terms
                  </div>
                  <details className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <summary className="cursor-pointer text-sm font-semibold text-slate-900">
                      Review terms and policies
                    </summary>
                    <div className="mt-3 space-y-4 text-sm leading-6 text-slate-700">
                      <div>
                        <div className="font-medium text-slate-900">Agreement terms</div>
                        <p className="mt-1 whitespace-pre-wrap">
                          {termsText || "Terms will appear here once finalized."}
                        </p>
                      </div>
                      {agreement.privacy_policy_snapshot ? (
                        <div>
                          <div className="font-medium text-slate-900">Privacy policy</div>
                          <p className="mt-1 whitespace-pre-wrap">{agreement.privacy_policy_snapshot}</p>
                        </div>
                      ) : null}
                    </div>
                  </details>
                </section>

                {lastSignResponse ? (
                  <section
                    className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm"
                    data-testid="public-agreement-confirmation"
                  >
                    <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                      Confirmation
                    </div>
                    <div className="mt-1 text-lg font-bold text-emerald-900">
                      Agreement signed successfully
                    </div>
                    <p className="mt-2 text-sm leading-6 text-emerald-800">
                      Next step: complete deposit funding if required. We’ll keep this agreement on file and continue with the project workflow.
                    </p>
                  </section>
                ) : null}
              </div>

              <aside className="space-y-4 lg:sticky lg:top-4 self-start">
                <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Agreement preview
                  </div>
                  {agreement.pdf_url ? (
                    <iframe
                      title="Agreement Preview"
                      src={agreement.pdf_url}
                      className="mt-3 h-[420px] w-full rounded-2xl border border-slate-200 bg-slate-50"
                    />
                  ) : (
                    <div className="mt-3 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                      PDF preview is not available.
                    </div>
                  )}
                </section>

                <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Signature
                  </div>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Please review the agreement above, then sign to unlock deposit funding and project confirmation.
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setIsSignOpen(true)}
                      className="inline-flex flex-1 items-center justify-center rounded-full bg-sky-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-500"
                      data-testid="public-agreement-open-signature"
                    >
                      Accept & Sign
                    </button>
                    <a
                      href={askQuestionHref}
                      className="inline-flex flex-1 items-center justify-center rounded-full border border-slate-300 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      Ask Question
                    </a>
                  </div>
                </section>

                <div data-testid="public-agreement-funding-section">
                  <PublicFundingCheckout
                    fundingToken={fundingToken}
                    agreementTitle={projectTitle}
                    onPaid={() => setReloadKey((v) => v + 1)}
                  />
                </div>

                <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Next steps
                  </div>
                  <ul className="mt-3 space-y-2 text-sm text-slate-600">
                    <li>• Review the scope and timeline.</li>
                    <li>• Sign the agreement when you’re ready.</li>
                    <li>• Fund the deposit through the secure payment step.</li>
                    <li>• We’ll keep you updated by email.</li>
                  </ul>
                </section>
              </aside>
            </div>

            <div className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
              <div className="mx-auto flex max-w-7xl gap-2">
                <button
                  type="button"
                  onClick={() => setIsSignOpen(true)}
                  className="flex-1 rounded-full bg-sky-600 px-4 py-3 text-sm font-semibold text-white"
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
            </div>
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
        onSigned={handleSigned}
      />
    </div>
  );
}
