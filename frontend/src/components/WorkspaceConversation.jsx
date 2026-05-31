import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, LoaderCircle, AlertTriangle, Info } from "lucide-react";

import api from "../api.js";
import { writeSessionAssistantHandoff } from "../lib/assistantHandoff.js";
import { buildAiContext, serializeAiContext } from "../lib/aiContext.js";
import { buildTemplateDraftPreview } from "../lib/startWithAiAssistant.js";
import { checkCompliance } from "../lib/complianceRules.js";
import { checkSchedulingConflicts } from "../lib/schedulingConflict.js";
import WorkspacePreviewPanel from "./WorkspacePreviewPanel.jsx";
import {
  saveConversation,
  loadConversation,
  clearConversation,
} from "../lib/conversationStorage.js";

// ── Conversation atoms ────────────────────────────────────────────────────

function AiMessage({ children }) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-bold text-white">
        AI
      </div>
      <div className="max-w-prose rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-800">
        {children}
      </div>
    </div>
  );
}

function UserMessage({ children }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-prose rounded-2xl rounded-tr-sm bg-slate-900 px-4 py-3 text-sm leading-6 text-white">
        {children}
      </div>
    </div>
  );
}

function Chip({ children, onClick, selected = false, testId, variant = "default" }) {
  const base = "rounded-full border px-4 py-2 text-sm font-semibold transition";
  const cls =
    variant === "primary"
      ? `${base} border-slate-900 bg-slate-900 text-white hover:bg-slate-800`
      : variant === "warning"
      ? `${base} border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100`
      : selected
      ? `${base} border-slate-900 bg-slate-900 text-white`
      : `${base} border-slate-200 bg-white text-slate-700 hover:border-slate-900`;
  return (
    <button type="button" onClick={onClick} data-testid={testId} className={cls}>
      {children}
    </button>
  );
}

function FlagNote({ flag, onAction, onSkip, onDismiss }) {
  const isWarning = flag.severity === "warning";
  return (
    <div className={`rounded-2xl border p-4 ${isWarning ? "border-amber-200 bg-amber-50" : "border-sky-100 bg-sky-50"}`}>
      <div className="flex items-start gap-2">
        {isWarning ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />}
        <div className={`text-sm leading-6 ${isWarning ? "text-amber-900" : "text-sky-900"}`}>{flag.message}</div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {flag.actionLabel && (
          <Chip onClick={onAction} variant={isWarning ? "warning" : "default"}>{flag.actionLabel}</Chip>
        )}
        <Chip onClick={onSkip}>Not needed</Chip>
        <Chip onClick={onDismiss}>Handle later</Chip>
      </div>
    </div>
  );
}

// ── Helper ────────────────────────────────────────────────────────────────

function formatAddress(addr) {
  if (!addr) return "";
  if (typeof addr === "string") return addr;
  return [addr.street || addr.address_line1 || addr.line1, addr.city, addr.state, addr.zip || addr.postal_code]
    .filter(Boolean)
    .join(", ");
}

async function searchCustomers(q) {
  try {
    const { data } = await api.get("/customers/", { params: { q, search: q, limit: 5 } });
    const list = Array.isArray(data) ? data : data?.results ?? [];
    return list.slice(0, 5);
  } catch {
    try {
      const { data } = await api.get("/projects/customers/", { params: { q, search: q, limit: 5 } });
      return (Array.isArray(data) ? data : data?.results ?? []).slice(0, 5);
    } catch {
      return [];
    }
  }
}

// ── Main component ────────────────────────────────────────────────────────

const PHASES = [
  "input",
  "classify",
  "template_match",
  "job_details",
  "customer_lookup",
  "customer_searching",
  "customer_result",
  "address_capture",
  "compliance_check",
  "scheduling_check",
  "preview_loading",
  "preview",
];

export default function WorkspaceConversation({ contractorProfile = null }) {
  const navigate = useNavigate();
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const hasRestoredRef = useRef(false);

  const contractorId = contractorProfile?.id ?? null;

  const [phase, setPhase] = useState("input");
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [loading, setLoading] = useState(false);

  // Tracks the initial job description submitted (used as collectedData.jobDescription)
  const [jobDescription, setJobDescription] = useState("");

  // Collected data across phases
  const [classifyResult, setClassifyResult] = useState(null);
  const [templateMatch, setTemplateMatch] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [projectAddress, setProjectAddress] = useState(null);
  const [addressInput, setAddressInput] = useState({ street: "", city: "", state: "", zip: "" });
  const [draftResult, setDraftResult] = useState(null);

  // Compliance / scheduling flags + current flag index
  const [complianceFlags, setComplianceFlags] = useState([]);
  const [schedulingFlags, setSchedulingFlags] = useState([]);
  const [flagIndex, setFlagIndex] = useState(0);
  const [unresolvedFlags, setUnresolvedFlags] = useState([]);

  // Customer search state
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState([]);

  // Restore persisted conversation on mount
  useEffect(() => {
    if (hasRestoredRef.current || !contractorId) return;
    const loaded = loadConversation("workspace_intake", contractorId);
    if (!loaded || !PHASES.includes(loaded.phase) || loaded.phase === "input") return;
    // Only restore if the contractor hasn't started typing something different
    const currentInput = inputText.trim();
    const savedJob = loaded.collectedData?.jobDescription ?? "";
    if (currentInput && currentInput !== savedJob) return;

    hasRestoredRef.current = true;
    setPhase(loaded.phase);
    setMessages(loaded.messages ?? []);
    const cd = loaded.collectedData ?? {};
    if (cd.jobDescription) setJobDescription(cd.jobDescription);
    if (cd.classifyResult) setClassifyResult(cd.classifyResult);
    if (cd.templateMatch) setTemplateMatch(cd.templateMatch);
    if (cd.customer) setCustomer(cd.customer);
    if (cd.projectAddress) setProjectAddress(cd.projectAddress);
    if (cd.addressInput) setAddressInput(cd.addressInput);
    if (Array.isArray(cd.complianceFlags)) setComplianceFlags(cd.complianceFlags);
    if (Array.isArray(cd.schedulingFlags)) setSchedulingFlags(cd.schedulingFlags);
    if (typeof cd.flagIndex === "number") setFlagIndex(cd.flagIndex);
    if (Array.isArray(cd.unresolvedFlags)) setUnresolvedFlags(cd.unresolvedFlags);
    if (cd.draftResult) setDraftResult(cd.draftResult);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist conversation on every meaningful phase or message change
  useEffect(() => {
    if (!contractorId || phase === "input") return;
    saveConversation("workspace_intake", contractorId, {
      phase,
      messages,
      collectedData: {
        jobDescription,
        classifyResult,
        templateMatch,
        customer,
        projectAddress,
        addressInput,
        complianceFlags,
        schedulingFlags,
        flagIndex,
        unresolvedFlags,
        draftResult,
      },
    });
  }, [phase, messages]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, phase]);

  function addAi(text) {
    setMessages((prev) => [...prev, { role: "ai", text }]);
  }
  function addUser(text) {
    setMessages((prev) => [...prev, { role: "user", text }]);
  }

  // ── PHASE 1: classify ──────────────────────────────────────────────────

  async function handleInputSubmit() {
    const text = inputText.trim();
    if (!text) return;
    addUser(text);
    setJobDescription(text);
    setInputText("");
    setPhase("classify");
    setLoading(true);

    let result = null;
    try {
      const { data } = await api.post("/agreements/ai/classify/", {
        description: text,
        context: serializeAiContext(buildAiContext({
          page: "workspace_intake",
          entityType: "agreement",
          existingScope: text || null,
        })),
      });
      result = data;
      setClassifyResult(data);
    } catch {
      // Use fallback classification
      result = { project_type: "", project_subtype: "", project_path: "residential", confidence: 0.5 };
      setClassifyResult(result);
    } finally {
      setLoading(false);
    }

    const typeLabel = [result?.project_type, result?.project_subtype].filter(Boolean).join(" · ") || "this job";
    const path = String(result?.project_path || "residential").toLowerCase();
    addAi(`Got it — I can see this is a ${typeLabel} job (${path}). Let me find a template match.`);
    enterTemplateMatch(result);
  }

  // ── PHASE 2: template_match ────────────────────────────────────────────

  function enterTemplateMatch(classify) {
    // Use classify result or fallback
    const type = classify?.project_type || "";
    const subtype = classify?.project_subtype || "";
    const subject = subtype || type || "general project";

    // Build a local template preview
    let draft = null;
    try {
      draft = buildTemplateDraftPreview(subject, {
        projectType: type,
        project_type: type,
        projectPath: classify?.project_path || "",
        project_path: classify?.project_path || "",
      });
    } catch {
      draft = null;
    }

    setTemplateMatch(draft);
    setPhase("template_match");

    if (draft?.template_name) {
      addAi(`I found a "${draft.template_name}" template — want to use it as your starting point, or build from scratch?`);
    } else {
      addAi("I didn't find a strong template match — I'll build a fresh structure from your description. Want to continue or pick a template first?");
    }
  }

  function handleUseTemplate() {
    addUser("Use the template");
    addAi("Great — I'll apply the template. Do you have any specific details to add to the scope?");
    setPhase("job_details");
  }

  function handleBuildFromScratch() {
    addUser("Build from scratch");
    addAi("No problem. Any specific scope details to add — materials, square footage, special requirements?");
    setPhase("job_details");
  }

  // ── PHASE 3: job_details ───────────────────────────────────────────────

  function handleJobDetailsSubmit() {
    const text = inputText.trim();
    if (text) {
      addUser(text);
      setClassifyResult((prev) => ({
        ...prev,
        extra_details: text,
      }));
    }
    setInputText("");
    enterCustomerLookup();
  }

  function handleJobDetailsSkip() {
    addUser("Skip for now");
    enterCustomerLookup();
  }

  // ── PHASE 4: customer_lookup ───────────────────────────────────────────

  function enterCustomerLookup() {
    setPhase("customer_lookup");
    addAi("Do you have a customer in mind for this job?");
  }

  function handleCustomerYes() {
    addUser("Yes, find them");
    setPhase("customer_searching");
    addAi("Search by name or email:");
  }

  function handleAddNewCustomer() {
    addUser("Add new customer");
    addAi("You can add the customer from the agreement wizard — I'll take you there with everything pre-filled.");
    enterAddressCapture(null);
  }

  function handleCustomerSkip() {
    addUser("Skip for now");
    enterAddressCapture(null);
  }

  // ── Customer search ────────────────────────────────────────────────────

  async function handleCustomerSearch() {
    const q = customerQuery.trim();
    if (!q) return;
    setLoading(true);
    try {
      const results = await searchCustomers(q);
      setCustomerResults(results);
    } finally {
      setLoading(false);
    }
  }

  function handleCustomerSelect(c) {
    addUser(`${c.full_name || c.name || "Customer selected"}`);
    setCustomer(c);
    setPhase("customer_result");
    addAi(
      `Found ${c.full_name || c.name}${c.email ? ` (${c.email})` : ""}. Is this the right customer?`
    );
  }

  function handleCustomerConfirm() {
    addUser("Yes, that's them");
    enterAddressCapture(customer);
  }

  function handleCustomerRetry() {
    addUser("Try again");
    setCustomer(null);
    setCustomerResults([]);
    setCustomerQuery("");
    setPhase("customer_searching");
    addAi("Search again:");
  }

  // ── PHASE 5: address_capture ───────────────────────────────────────────

  function enterAddressCapture(cust) {
    const path = String(classifyResult?.project_path || "residential").toLowerCase();
    const homeAddr = cust?.home_address || cust?.address || cust?.project_address;

    if (path === "residential" && homeAddr) {
      setPhase("address_capture");
      addAi(`Is the project at ${formatAddress(homeAddr)}?`);
      setProjectAddress(homeAddr);
    } else if (path === "commercial") {
      setPhase("address_capture");
      addAi("What's the address for this job?");
    } else {
      // Residential but no home address on file
      const name = cust?.full_name || cust?.name || "the customer";
      setPhase("address_capture");
      addAi(`What's the project address? I'll also save this to ${name}'s profile.`);
    }
  }

  function handleUseExistingAddress() {
    addUser("Yes, that's the address");
    proceedWithAddress(projectAddress);
  }

  function handleAddressInputSubmit() {
    const addr = {
      street: addressInput.street.trim(),
      city: addressInput.city.trim(),
      state: addressInput.state.trim(),
      zip: addressInput.zip.trim(),
    };
    if (!addr.city && !addr.state && !addr.street) {
      proceedWithAddress(null);
      return;
    }
    addUser(formatAddress(addr));
    proceedWithAddress(addr);
  }

  function handleAddressSkip() {
    addUser("Skip for now");
    proceedWithAddress(null);
  }

  function proceedWithAddress(addr) {
    if (addr) setProjectAddress(addr);
    runComplianceCheck(addr);
  }

  // ── PHASE 6: compliance_check ──────────────────────────────────────────

  function runComplianceCheck(addr) {
    const skills = Array.isArray(contractorProfile?.skills) ? contractorProfile.skills : [];
    const licenses = Array.isArray(contractorProfile?.licenses) ? contractorProfile.licenses : [];
    const certs = Array.isArray(contractorProfile?.employee_certs) ? contractorProfile.employee_certs : [];
    const flags = checkCompliance({
      projectType: classifyResult?.project_type || "",
      projectAddressState: addr?.state || classifyResult?.state || "",
      contractorTradeProfile: skills,
      contractorLicenses: licenses,
      employeeCerts: certs,
    });
    setComplianceFlags(flags);
    setFlagIndex(0);

    if (flags.length === 0) {
      runSchedulingCheck();
    } else {
      setPhase("compliance_check");
      addAi("Before we finalize — a few things to be aware of:");
    }
  }

  function handleFlagAction(flag) {
    addUser(flag.actionLabel);
    // Add to unresolved so it shows in preview
    setUnresolvedFlags((prev) => [...prev, flag]);
    advanceFlagOrNext("compliance");
  }
  function handleFlagSkip() {
    addUser("Not needed");
    advanceFlagOrNext("compliance");
  }
  function handleFlagLater(flag) {
    addUser("Handle later");
    setUnresolvedFlags((prev) => [...prev, flag]);
    advanceFlagOrNext("compliance");
  }

  function advanceFlagOrNext(kind) {
    const flags = kind === "compliance" ? complianceFlags : schedulingFlags;
    const next = flagIndex + 1;
    if (next < flags.length) {
      setFlagIndex(next);
    } else {
      setFlagIndex(0);
      if (kind === "compliance") {
        runSchedulingCheck();
      } else {
        enterPreview();
      }
    }
  }

  // ── PHASE 7: scheduling_check ──────────────────────────────────────────

  function runSchedulingCheck() {
    const agreements = []; // Would be passed as prop in a richer implementation
    const flags = checkSchedulingConflicts({
      proposedStartDate: null, // No date collected in Phase 1 scope
      proposedEndDate: null,
      activeAgreements: agreements,
      employees: [],
      subcontractors: [],
    });
    setSchedulingFlags(flags);
    setFlagIndex(0);

    if (flags.length === 0) {
      enterPreview();
    } else {
      setPhase("scheduling_check");
      addAi("One scheduling note:");
    }
  }

  // ── PHASE 8: preview ───────────────────────────────────────────────────

  async function enterPreview() {
    setPhase("preview_loading");
    setLoading(true);
    addAi("Assembling your job preview...");

    let draft = null;
    try {
      const body = {
        project_type: classifyResult?.project_type || "",
        project_subtype: classifyResult?.project_subtype || "",
        project_path: classifyResult?.project_path || "residential",
        description: classifyResult?.description || classifyResult?.extra_details || "",
        customer_id: customer?.id || undefined,
        project_address: projectAddress || undefined,
        template_id: templateMatch?.template_id || undefined,
        context: serializeAiContext(buildAiContext({
          page: "workspace_intake",
          entityType: "agreement",
          projectType: classifyResult?.project_type || null,
          projectSubtype: classifyResult?.project_subtype || null,
          projectPath: classifyResult?.project_path || "residential",
          projectAddress: projectAddress || null,
          customerName: customer?.name || customer?.full_name || null,
        })),
      };
      const { data } = await api.post("/agreements/ai/draft/", body);
      draft = data;
    } catch {
      draft = null;
    } finally {
      setLoading(false);
    }

    setDraftResult(draft);
    setPhase("preview");
    addAi("Here's your job preview. Does this look right?");
  }

  // ── PHASE 9: confirm + handoff ─────────────────────────────────────────

  function handleConfirm() {
    clearConversation("workspace_intake", contractorId);
    addUser("Open agreement wizard →");

    const prefill = {
      customer_name: customer?.full_name || customer?.name || "",
      project_type: classifyResult?.project_type || draftResult?.project_type || "",
      project_subtype: classifyResult?.project_subtype || draftResult?.project_subtype || "",
      project_summary:
        draftResult?.scope_summary ||
        draftResult?.description ||
        classifyResult?.description ||
        "",
    };

    const draftPayload = {
      ...(draftResult || {}),
      project_type: classifyResult?.project_type || "",
      project_subtype: classifyResult?.project_subtype || "",
      project_path: classifyResult?.project_path || "residential",
      description: draftResult?.description || "",
      customer_id: customer?.id || null,
      project_address: projectAddress || null,
      template_id: templateMatch?.template_id || null,
    };

    const handoffState = {
      assistantPrefill: prefill,
      assistantDraftPayload: draftPayload,
      assistantWizardStepTarget: 1,
      assistantSuggestedMilestones: [],
      assistantClarificationQuestions: Array.isArray(classifyResult?.clarification_questions)
        ? classifyResult.clarification_questions
        : [],
      assistantEstimatePreview: {
        low: draftResult?.estimated_price_low,
        high: draftResult?.estimated_price_high,
      },
      assistantProjectAddress: projectAddress || null,
      assistantComplianceFlags: unresolvedFlags,
      assistantIntent: "start_agreement",
      assistantContext: { page: "dashboard", workspace_mode: "dashboard" },
    };

    writeSessionAssistantHandoff(handoffState);
    navigate("/app/agreements/new/wizard?step=1", { state: handoffState });
  }

  function handleEditDetails() {
    addUser("Edit details first");
    setPhase("job_details");
    addAi("What would you like to change?");
  }

  // ── Render ─────────────────────────────────────────────────────────────

  const currentFlag =
    phase === "compliance_check"
      ? complianceFlags[flagIndex]
      : phase === "scheduling_check"
      ? schedulingFlags[flagIndex]
      : null;

  const showInitialInput = phase === "input";

  return (
    <div
      className="flex flex-col gap-4"
      data-testid="workspace-conversation"
    >
      {/* Message thread */}
      {messages.length > 0 ? (
        <div className="space-y-4 rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
          {messages.map((msg, i) =>
            msg.role === "ai" ? (
              <AiMessage key={i}>{msg.text}</AiMessage>
            ) : (
              <UserMessage key={i}>{msg.text}</UserMessage>
            )
          )}
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <LoaderCircle className="h-4 w-4 animate-spin" />
              Working...
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>
      ) : null}

      {/* Phase-specific input area */}

      {/* PHASE: input — initial textarea */}
      {showInitialInput ? (
        <div className="rounded-[28px] border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500 mb-2">
            AI Workspace
          </div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            Start or continue work
          </h2>
          <p className="mt-2 text-sm text-slate-600">
            Describe the job you want to start and I'll classify it, match a template, and build
            the draft before handing you off to the wizard.
          </p>
          <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3">
            <textarea
              ref={inputRef}
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleInputSubmit();
              }}
              rows={4}
              placeholder="Describe the work, e.g. 'Install new asphalt shingle roof for a residential home in Austin' or 'Commercial HVAC replacement, 4,000 sq ft office building...'"
              data-testid="workspace-conversation-input"
              className="w-full resize-none bg-transparent text-sm text-slate-900 outline-none placeholder:text-slate-400"
            />
            <div className="mt-2 flex items-center justify-end border-t border-slate-200 pt-3">
              <button
                type="button"
                onClick={handleInputSubmit}
                disabled={!inputText.trim() || loading}
                data-testid="workspace-conversation-submit"
                className="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                Start intake
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* PHASE: template_match */}
      {phase === "template_match" ? (
        <div className="flex flex-wrap gap-3">
          <Chip onClick={handleUseTemplate} variant="primary" testId="workspace-use-template">
            Use the template
          </Chip>
          <Chip onClick={handleBuildFromScratch} testId="workspace-build-scratch">
            Build from scratch
          </Chip>
        </div>
      ) : null}

      {/* PHASE: job_details */}
      {phase === "job_details" ? (
        <div className="flex gap-2">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleJobDetailsSubmit()}
            placeholder="Add details or skip..."
            data-testid="workspace-job-details-input"
            className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-900"
          />
          <Chip onClick={handleJobDetailsSubmit} variant="primary">Continue</Chip>
          <Chip onClick={handleJobDetailsSkip}>Skip</Chip>
        </div>
      ) : null}

      {/* PHASE: customer_lookup */}
      {phase === "customer_lookup" ? (
        <div className="flex flex-wrap gap-3">
          <Chip onClick={handleCustomerYes} variant="primary" testId="workspace-customer-yes">
            Yes, find them
          </Chip>
          <Chip onClick={handleAddNewCustomer} testId="workspace-customer-add">
            Add new customer
          </Chip>
          <Chip onClick={handleCustomerSkip} testId="workspace-customer-skip">
            Skip for now
          </Chip>
        </div>
      ) : null}

      {/* PHASE: customer_searching */}
      {phase === "customer_searching" ? (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={customerQuery}
              onChange={(e) => setCustomerQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCustomerSearch()}
              placeholder="Name or email..."
              data-testid="workspace-customer-search-input"
              className="flex-1 rounded-2xl border border-slate-200 px-4 py-3 text-sm outline-none focus:border-slate-900"
            />
            <button
              type="button"
              onClick={handleCustomerSearch}
              disabled={loading || !customerQuery.trim()}
              className="rounded-2xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
            >
              {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : "Search"}
            </button>
          </div>
          {customerResults.length > 0 ? (
            <div className="space-y-2">
              {customerResults.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => handleCustomerSelect(c)}
                  data-testid={`workspace-customer-result-${c.id}`}
                  className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left text-sm hover:border-slate-900"
                >
                  <span className="font-semibold text-slate-900">{c.full_name || c.name}</span>
                  <span className="text-slate-500">{c.email || c.phone || ""}</span>
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex gap-2">
            <Chip onClick={handleCustomerSkip}>Skip for now</Chip>
          </div>
        </div>
      ) : null}

      {/* PHASE: customer_result */}
      {phase === "customer_result" ? (
        <div className="flex flex-wrap gap-3">
          <Chip onClick={handleCustomerConfirm} variant="primary" testId="workspace-customer-confirm">
            Yes, that's them
          </Chip>
          <Chip onClick={handleCustomerRetry} testId="workspace-customer-retry">
            Try again
          </Chip>
          <Chip onClick={() => { addUser("Skip"); enterAddressCapture(null); }}>
            Skip customer
          </Chip>
        </div>
      ) : null}

      {/* PHASE: address_capture */}
      {phase === "address_capture" ? (
        <div className="space-y-3">
          {projectAddress ? (
            // Offer existing address (residential with home address)
            <div className="flex flex-wrap gap-3">
              <Chip onClick={handleUseExistingAddress} variant="primary" testId="workspace-address-confirm">
                Yes, that's the address
              </Chip>
              <Chip onClick={() => setProjectAddress(null)} testId="workspace-address-different">
                Different address
              </Chip>
            </div>
          ) : (
            // Address input
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <input type="text" value={addressInput.street} onChange={(e) => setAddressInput(p => ({ ...p, street: e.target.value }))} placeholder="Street address" className="col-span-2 rounded-2xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-slate-900" data-testid="workspace-address-street" />
                <input type="text" value={addressInput.city} onChange={(e) => setAddressInput(p => ({ ...p, city: e.target.value }))} placeholder="City" className="rounded-2xl border border-slate-200 px-4 py-2.5 text-sm outline-none focus:border-slate-900" data-testid="workspace-address-city" />
                <div className="flex gap-2">
                  <input type="text" value={addressInput.state} onChange={(e) => setAddressInput(p => ({ ...p, state: e.target.value }))} placeholder="State" maxLength={2} className="w-20 rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-900" data-testid="workspace-address-state" />
                  <input type="text" value={addressInput.zip} onChange={(e) => setAddressInput(p => ({ ...p, zip: e.target.value }))} placeholder="ZIP" className="flex-1 rounded-2xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-slate-900" data-testid="workspace-address-zip" />
                </div>
              </div>
              <div className="flex gap-2">
                <Chip onClick={handleAddressInputSubmit} variant="primary">Confirm address</Chip>
                <Chip onClick={handleAddressSkip}>Skip for now</Chip>
              </div>
            </div>
          )}
        </div>
      ) : null}

      {/* PHASE: compliance_check / scheduling_check */}
      {(phase === "compliance_check" || phase === "scheduling_check") && currentFlag ? (
        <FlagNote
          flag={currentFlag}
          onAction={() => handleFlagAction(currentFlag)}
          onSkip={handleFlagSkip}
          onDismiss={() => handleFlagLater(currentFlag)}
        />
      ) : null}

      {/* PHASE: preview */}
      {phase === "preview" ? (
        <WorkspacePreviewPanel
          title={draftResult?.title || [classifyResult?.project_type, classifyResult?.project_subtype].filter(Boolean).join(" – ") || "New Agreement"}
          customer={customer}
          projectAddress={projectAddress}
          projectPath={classifyResult?.project_path || "residential"}
          templateName={templateMatch?.template_name || null}
          milestoneCount={
            Array.isArray(templateMatch?.milestones)
              ? templateMatch.milestones.length
              : 0
          }
          estimatedPriceLow={draftResult?.estimated_price_low}
          estimatedPriceHigh={draftResult?.estimated_price_high}
          unresolvedFlags={unresolvedFlags}
          onConfirm={handleConfirm}
          onEditDetails={handleEditDetails}
        />
      ) : null}

      {/* PHASE: classify loading spinner (before first message) */}
      {phase === "classify" && messages.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-slate-500 p-4">
          <LoaderCircle className="h-4 w-4 animate-spin" />
          Classifying your job...
        </div>
      ) : null}
    </div>
  );
}
