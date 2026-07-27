import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { buildObservationEnvelope, classifyDuplicate, parseLaserReading, repeatStatistics } from "./laserSpike.js";
import "./spike.css";

if (import.meta.env.PROD) {
  throw new Error("The STABILA engineering spike is unavailable in production.");
}

const assignmentDefaults = {
  project: "", session: "", room: "", measurementType: "", dimensionType: "length",
  label: "", category: "", repeatGroup: "", notes: "",
};

function App() {
  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const keySequenceRef = useRef([]);
  const [armed, setArmed] = useState(false);
  const [buffer, setBuffer] = useState("");
  const [terminator, setTerminator] = useState("enter");
  const [timeoutMs, setTimeoutMs] = useState(900);
  const [decimalSeparator, setDecimalSeparator] = useState("auto");
  const [captureSession, setCaptureSession] = useState(() => crypto.randomUUID());
  const [sessionLabel, setSessionLabel] = useState("");
  const [firmware, setFirmware] = useState("");
  const [readings, setReadings] = useState([]);
  const [focusState, setFocusState] = useState(document.hasFocus() ? "Browser focused" : "Browser not focused");
  const [online, setOnline] = useState(navigator.onLine);
  const [assignment, setAssignment] = useState(assignmentDefaults);
  const [preferredId, setPreferredId] = useState("");
  const [status, setStatus] = useState("Disarmed. No keyboard input is captured.");

  useEffect(() => {
    const focus = () => setFocusState("Browser focused");
    const blur = () => { setFocusState("Browser not focused"); if (armed) setStatus("Focus lost. Capture remains armed but cannot safely receive input."); };
    const visibility = () => setFocusState(document.visibilityState === "visible" ? (document.hasFocus() ? "Browser focused" : "Tab visible, browser not focused") : "Tab inactive");
    const connected = () => setOnline(true);
    const disconnected = () => setOnline(false);
    window.addEventListener("focus", focus); window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", connected); window.addEventListener("offline", disconnected);
    return () => {
      window.removeEventListener("focus", focus); window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", connected); window.removeEventListener("offline", disconnected);
      clearTimeout(timerRef.current);
    };
  }, [armed]);

  function arm() {
    keySequenceRef.current = [];
    setArmed(true); setBuffer(""); setStatus("Armed. Only the dedicated reading field will capture input.");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function disarm(message = "Disarmed. No keyboard input is captured.") {
    setArmed(false); clearTimeout(timerRef.current); setStatus(message); inputRef.current?.blur();
  }

  function commit(reason, manualText = buffer) {
    clearTimeout(timerRef.current);
    const capturedAt = new Date().toISOString();
    const parsed = parseLaserReading(manualText, { decimalSeparator, capturedAt });
    const row = {
      ...parsed, id: crypto.randomUUID(), capture_session_id: captureSession,
      session_label: sessionLabel, terminator: reason, key_sequence: [...keySequenceRef.current],
    };
    row.duplicate_state = classifyDuplicate(row, readings);
    setReadings((current) => [...current, row]);
    setBuffer("");
    disarm(`Captured with ${reason}. Review the immutable raw value before re-arming.`);
  }

  function inputChanged(event) {
    if (!armed) return;
    const next = event.target.value.slice(0, 80);
    setBuffer(next);
    if (terminator === "timeout") {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => commit("timeout", next), timeoutMs);
    }
  }

  function keyDown(event) {
    if (!armed) return;
    if (event.key.length === 1 || ["Enter", "Tab", "Backspace", "Delete"].includes(event.key)) {
      keySequenceRef.current.push(event.key);
    }
    if ((terminator === "enter" && event.key === "Enter") || (terminator === "tab" && event.key === "Tab")) {
      event.preventDefault();
      commit(event.key);
    }
  }

  function reset() {
    disarm(); setReadings([]); setBuffer(""); setAssignment(assignmentDefaults);
    setPreferredId(""); setCaptureSession(crypto.randomUUID()); setStatus("Spike reset. No data persisted.");
  }

  const latestValid = [...readings].reverse().find((row) => row.parse_status === "valid");
  const envelope = latestValid ? buildObservationEnvelope(latestValid, {
    firmwareVersion: firmware, receivedAt: latestValid.captured_at, idempotencyKey: latestValid.id,
  }) : null;
  const grouped = useMemo(() => readings.filter((row) => row.parse_status === "valid" && assignment.repeatGroup), [readings, assignment.repeatGroup]);
  const stats = repeatStatistics(grouped);

  return (
    <main>
      <header>
        <p className="eyebrow">Engineering Spike — Not Production</p>
        <h1>STABILA LD 530 BT keypad capture harness</h1>
        <p className="warning">HARNESS COMPLETE — HARDWARE VALIDATION BLOCKED. No device behavior shown here is a compatibility claim.</p>
      </header>

      <section className="status-grid" aria-live="polite">
        <strong className={armed ? "good" : ""}>{armed ? "ARMED" : "DISARMED"}</strong>
        <span>{focusState}</span><span>{online ? "Browser online" : "Browser offline"}</span><span>{status}</span>
      </section>

      <section>
        <h2>1. Capture one reading</h2>
        <div className="grid">
          <label>Capture session label<input value={sessionLabel} onChange={(e) => setSessionLabel(e.target.value.slice(0, 80))} placeholder="Bench test A" /></label>
          <label>Firmware (record manually)<input value={firmware} onChange={(e) => setFirmware(e.target.value.slice(0, 40))} placeholder="Unknown — hardware blocked" /></label>
          <label>Decimal separator<select value={decimalSeparator} onChange={(e) => setDecimalSeparator(e.target.value)}><option value="auto">Unknown / require choice</option><option value="period">Period (.)</option><option value="comma">Comma (,)</option></select></label>
          <label>Terminator<select value={terminator} onChange={(e) => setTerminator(e.target.value)}><option value="enter">Enter</option><option value="tab">Tab</option><option value="timeout">Timeout</option></select></label>
          {terminator === "timeout" ? <label>Timeout milliseconds<input type="number" min="250" max="5000" value={timeoutMs} onChange={(e) => setTimeoutMs(Math.min(5000, Math.max(250, Number(e.target.value))))} /></label> : null}
        </div>
        <div className="actions"><button onClick={arm}>Arm Capture</button><button className="secondary" onClick={() => disarm()}>Disarm</button><button className="secondary" onClick={reset}>Clear / Reset</button></div>
        <label className="capture-field">Dedicated armed input
          <input ref={inputRef} disabled={!armed} value={buffer} onChange={inputChanged} onKeyDown={keyDown} onBlur={() => armed && setStatus("Dedicated input lost focus. Disarm or refocus it before transmitting.")} placeholder={armed ? "Transmit or type a fixture reading now" : "Arm capture first"} autoComplete="off" />
        </label>
        <details><summary>Manual fallback fixture entry</summary><p>Arm the field and type a synthetic format such as <code>12.345 m</code>. This tests the harness, not the device.</p></details>
      </section>

      <section>
        <h2>2. Captured observations</h2>
        {!readings.length ? <p>No observations captured. Nothing is stored or uploaded.</p> :
          <div className="table-wrap"><table><thead><tr><th>Raw</th><th>Parsed</th><th>Unit</th><th>Status</th><th>Duplicate</th><th>Terminator</th><th>Preferred</th></tr></thead>
          <tbody>{readings.map((row) => <tr key={row.id}><td><code>{row.raw_text}</code></td><td>{row.normalized_value || "—"}</td><td>{row.reported_unit || "missing"}</td><td>{row.parse_status}<br />{row.warnings.join(" ")}</td><td>{row.duplicate_state}</td><td>{row.terminator}</td><td><input type="radio" name="preferred" aria-label={`Prefer ${row.raw_text}`} checked={preferredId === row.id} onChange={() => setPreferredId(row.id)} /></td></tr>)}</tbody></table></div>}
      </section>

      <section>
        <h2>3. Mock target assignment</h2>
        <p>Local labels only. No projects, sessions, customers, APIs, or production data are loaded.</p>
        <div className="grid">{Object.entries(assignment).map(([key, value]) => key === "notes" ? <label key={key}>{key}<textarea value={value} onChange={(e) => setAssignment((current) => ({ ...current, [key]: e.target.value.slice(0, 500) }))} /></label> : <label key={key}>{key}<input value={value} onChange={(e) => setAssignment((current) => ({ ...current, [key]: e.target.value.slice(0, 120) }))} /></label>)}</div>
        <p><strong>Flow:</strong> Reading received → user assigns what was measured → observation preview → would create Measurement proposal.</p>
      </section>

      <section>
        <h2>4. Repeat analysis</h2>
        {!stats ? <p>Enter a repeat group and capture valid fixture readings to calculate local statistics.</p> :
          <pre>{JSON.stringify({ ...stats, preferred_reading_id: preferredId || null, warning: stats.absolute_spread === "0.0000000000" ? "" : "Readings disagree; do not average silently.", verification_status: "needs_verification" }, null, 2)}</pre>}
      </section>

      <section>
        <h2>5. Non-persistent observation envelope</h2>
        <pre>{envelope ? JSON.stringify({ ...envelope, mock_assignment: assignment }, null, 2) : "Capture a valid fixture reading to preview the bounded envelope."}</pre>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
