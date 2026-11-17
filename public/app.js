const $ = (id) => document.getElementById(id);
let token = "";
let account = null;
let lastDecision = null;
let clinicianAction = null;
let toastTimer;

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 3400);
}

async function whileBusy(button, label, operation) {
  const original = button.textContent;
  const wasDisabled = button.disabled;
  button.disabled = true;
  button.textContent = label;
  try { await operation(); }
  finally {
    button.disabled = wasDisabled;
    button.textContent = original;
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...options.headers }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed.");
  return body;
}

function actionFromForm() {
  return {
    requestId: $("requestId").value.trim(),
    reportId: $("reportId").value.trim(),
    patientId: $("patientId").value.trim(),
    recipientId: $("recipientId").value.trim()
  };
}

function newRequestId() {
  return `req-demo-${crypto.randomUUID().slice(0, 8)}`;
}

function renderRules(rules = []) {
  $("ruleList").replaceChildren();
  if (!rules.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Rules will appear here.";
    $("ruleList").append(empty);
    return;
  }
  for (const rule of rules) {
    const item = document.createElement("div");
    item.className = "rule";
    const dot = document.createElement("span");
    dot.className = `rule-dot ${rule.status.toLowerCase()}`;
    const content = document.createElement("div");
    const name = document.createElement("div");
    name.className = "rule-name";
    name.textContent = rule.rule.replaceAll("_", " ");
    const explanation = document.createElement("div");
    explanation.className = "rule-explanation";
    explanation.textContent = rule.explanation;
    content.append(name, explanation);
    const status = document.createElement("span");
    status.className = `rule-status ${rule.status.toLowerCase()}`;
    status.textContent = rule.status.replaceAll("_", " ");
    item.append(dot, content, status);
    $("ruleList").append(item);
  }
}

function populateProposalOptions(data) {
  const patientNames = new Map(data.patients.map((patient) => [patient.id, patient.name]));
  const lists = {
    reportOptions: data.reports.map((report) => ({
      value: report.id,
      label: `${report.title} · ${patientNames.get(report.patientId) || report.patientId}${report.requiresClinicianReview ? " · review required" : ""}`
    })),
    patientOptions: data.patients.map((patient) => ({ value: patient.id, label: patient.name })),
    recipientOptions: data.patients.map((patient) => ({ value: patient.inboxId, label: `${patient.name} inbox` }))
  };
  for (const [id, options] of Object.entries(lists)) {
    const list = $(id);
    list.replaceChildren();
    for (const item of options) {
      const option = document.createElement("option");
      option.value = item.value;
      option.label = item.label;
      list.append(option);
    }
  }
}

function populateReportPatients(patients) {
  const select = $("newReportPatient");
  const selected = select.value;
  select.replaceChildren();
  for (const patient of patients) {
    const option = document.createElement("option");
    option.value = patient.id;
    option.textContent = `${patient.name} · ${patient.inboxId}`;
    select.append(option);
  }
  if (patients.some((patient) => patient.id === selected)) select.value = selected;
}

async function refreshDemoAccounts() {
  const { accounts } = await api("/api/demo-accounts");
  const select = $("accountSelect");
  const selected = select.value;
  select.replaceChildren();
  for (const accountOption of accounts) {
    const option = document.createElement("option");
    option.value = accountOption.id;
    option.textContent = accountOption.label;
    select.append(option);
  }
  if (accounts.some((item) => item.id === selected)) select.value = selected;
}

function showDecision(result, message) {
  lastDecision = result;
  const labels = { ALLOW: "Allowed", BLOCK: "Blocked", REVIEW_REQUIRED: "Review required" };
  const classes = { ALLOW: "allow", BLOCK: "block", REVIEW_REQUIRED: "review" };
  const title = labels[result.decision] || result.decision;
  $("decisionTitle").textContent = title;
  $("decisionBadge").className = `decision-badge ${classes[result.decision] || "neutral"}`;
  $("decisionBadge").textContent = result.decision.replaceAll("_", " ");
  $("decisionMessage").textContent = message || (result.decision === "ALLOW"
    ? "All deterministic checks passed. Execution will recheck these rules."
    : result.decision === "REVIEW_REQUIRED"
      ? "No inbox delivery has occurred. A clinician must approve this exact action."
      : "This action is blocked. No inbox delivery has occurred.");
  renderRules(result.rules);
  $("clinicianActions").hidden = result.decision !== "REVIEW_REQUIRED";
  clinicianAction = result.decision === "REVIEW_REQUIRED" ? actionFromForm() : null;
}

function renderAudit(list, audit) {
  list.replaceChildren();
  if (!audit?.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No actions recorded yet.";
    list.append(empty);
    return;
  }
  for (const entry of audit) {
    const row = document.createElement("div");
    row.className = "audit-entry";
    const result = document.createElement("span");
    result.className = `audit-outcome ${entry.decision}`;
    result.textContent = entry.decision.replaceAll("_", " ");
    const detail = document.createElement("span");
    detail.className = "audit-detail";
    detail.textContent = `${entry.accountLabel} · ${entry.reportId} → ${entry.patientId}${entry.deliveryId ? ` · ${entry.deliveryId}` : ""}`;
    const time = document.createElement("span");
    time.className = "audit-time";
    time.textContent = new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    row.append(result, detail, time);
    list.append(row);
  }
}

async function loadView() {
  const data = await api("/api/data");
  $("signin").hidden = true;
  $("dashboard").hidden = false;
  $("accountName").textContent = data.account.label;
  for (const id of ["agentView", "clinicianView", "patientView"]) $(id).hidden = true;
  if (account.role === "agent") {
    $("agentView").hidden = false;
    populateProposalOptions(data);
    renderAudit($("auditList"), data.audit);
  } else if (account.role === "clinician") {
    $("clinicianView").hidden = false;
    populateReportPatients(data.patients);
    renderAudit($("clinicianAudit"), data.audit);
    renderPendingActions(data.pendingActions || []);
    renderClinicianProposal();
  } else {
    $("patientView").hidden = false;
    renderInbox(data.inbox);
  }
}

function renderInbox(inbox) {
  $("inboxList").replaceChildren();
  if (!inbox.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No reports have been delivered to this inbox.";
    $("inboxList").append(empty);
    return;
  }
  for (const report of inbox) {
    const card = document.createElement("article");
    card.className = "inbox-card";
    const heading = document.createElement("h3");
    heading.textContent = report.title;
    const meta = document.createElement("div");
    meta.className = "inbox-meta";
    meta.textContent = `Report ${report.reportId} · ${report.date} · Delivered ${new Date(report.deliveredAt).toLocaleString()}`;
    const details = document.createElement("p");
    details.textContent = report.details;
    card.append(heading, meta);
    if (report.summary && report.summary !== report.details) {
      const summary = document.createElement("p");
      summary.textContent = report.summary;
      card.append(summary);
    }
    card.append(details);
    $("inboxList").append(card);
  }
}

function renderClinicianProposal() {
  const box = $("clinicianProposal");
  box.replaceChildren();
  const action = clinicianAction;
  $("clinicianApproveButton").disabled = !action;
  if (!action) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Switch back to the simulated agent to prepare a proposal.";
    box.append(empty);
    return;
  }
  for (const [label, value] of Object.entries(action)) {
    const line = document.createElement("div");
    const strong = document.createElement("b");
    strong.textContent = `${label}: `;
    line.append(strong, document.createTextNode(value));
    box.append(line);
  }
}

function renderPendingActions(actions) {
  const list = $("pendingReviews");
  list.replaceChildren();
  if (!actions.length) {
    clinicianAction = null;
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No actions are awaiting review.";
    list.append(empty);
    return;
  }
  const selected = actions.find((item) => item.action.requestId === clinicianAction?.requestId) || actions[0];
  clinicianAction = selected.action;
  for (const item of actions) {
    const button = document.createElement("button");
    button.className = `pending-review${item.action.requestId === clinicianAction.requestId ? " selected" : ""}`;
    button.type = "button";
    const title = document.createElement("b");
    title.textContent = `${item.action.reportId} · ${item.action.patientId}`;
    const meta = document.createElement("span");
    meta.textContent = `Request ${item.action.requestId} · report v${item.reportVersion}`;
    button.append(title, meta);
    button.addEventListener("click", () => {
      clinicianAction = item.action;
      renderPendingActions(actions);
      renderClinicianProposal();
    });
    list.append(button);
  }
}

async function signIn() {
  try {
    const data = await api("/api/sign-in", { method: "POST", body: JSON.stringify({ accountId: $("accountSelect").value }) });
    token = data.token;
    account = data.account;
    await loadView();
    showToast(`Signed in as ${account.label}.`);
  } catch (error) { showToast(error.message); }
}

$("signInButton").addEventListener("click", () => whileBusy($("signInButton"), "Signing in…", signIn));
$("signOutButton").addEventListener("click", async () => {
  try { await api("/api/sign-out", { method: "POST" }); }
  catch (error) { showToast(error.message); }
  token = "";
  account = null;
  $("dashboard").hidden = true;
  $("signin").hidden = false;
  refreshDemoAccounts().catch((error) => showToast(error.message));
});

document.querySelectorAll(".scenario").forEach((button) => button.addEventListener("click", () => {
  if (account?.role !== "agent") return;
  const scenarios = {
    wrong: { reportId: "report-fake-501", patientId: "patient-fake-208", recipientId: "inbox-fake-208" },
    unauthorized: { reportId: "report-fake-501", patientId: "patient-fake-104", recipientId: "inbox-fake-208" },
    correct: { reportId: "report-fake-501", patientId: "patient-fake-104", recipientId: "inbox-fake-104" },
    review: { reportId: "report-fake-502", patientId: "patient-fake-104", recipientId: "inbox-fake-104" }
  };
  const scenario = scenarios[button.dataset.scenario];
  $("requestId").value = newRequestId();
  for (const [key, value] of Object.entries(scenario)) $(key).value = value;
  lastDecision = null;
  clinicianAction = null;
  $("clinicianActions").hidden = true;
  $("decisionTitle").textContent = "Ready to review";
  $("decisionBadge").className = "decision-badge neutral";
  $("decisionBadge").textContent = "Awaiting preview";
  $("decisionMessage").textContent = "Scenario loaded. Preview checks before execution.";
  renderRules([]);
}));

document.querySelectorAll(".field-grid input").forEach((input) => input.addEventListener("input", () => {
  if (input.id !== "requestId") $("requestId").value = newRequestId();
  lastDecision = null;
  clinicianAction = null;
  $("clinicianActions").hidden = true;
  $("decisionMessage").textContent = "Proposal changed. Preview the new action before execution.";
}));

$("previewButton").addEventListener("click", () => whileBusy($("previewButton"), "Checking…", async () => {
  try {
    const result = await api("/api/preview", { method: "POST", body: JSON.stringify(actionFromForm()) });
    showDecision(result);
  } catch (error) { showToast(error.message); }
}));

$("executeButton").addEventListener("click", () => whileBusy($("executeButton"), "Executing…", async () => {
  try {
    const result = await api("/api/execute", { method: "POST", body: JSON.stringify(actionFromForm()) });
    const message = result.message || (result.decision === "BLOCK" && result.rules?.some((rule) => rule.explanation.startsWith("Already delivered"))
      ? "Already delivered. No additional inbox item was created."
      : result.decision === "REVIEW_REQUIRED" ? "Approval pending. No inbox delivery has occurred." : undefined);
    showDecision(result, message);
    showToast(message || (result.decision === "ALLOW" ? "Delivery persisted to the synthetic inbox." : "Action recorded; no delivery was made."));
    const data = await api("/api/data");
    renderAudit($("auditList"), data.audit);
  } catch (error) { showToast(error.message); }
}));

async function approveCurrentAction() {
  const action = clinicianAction;
  if (account?.role !== "clinician" || !action) return;
  try {
    const result = await api("/api/approve", { method: "POST", body: JSON.stringify(action) });
    showToast(result.message);
    if (account.role === "clinician") renderClinicianProposal();
    else {
      const preview = await api("/api/preview", { method: "POST", body: JSON.stringify(action) });
      showDecision(preview, "Clinician approval recorded. Sign back in as the simulated agent to execute.");
    }
    if (account.role === "clinician") {
      const data = await api("/api/data");
      renderPendingActions(data.pendingActions || []);
      renderClinicianProposal();
      renderAudit($("clinicianAudit"), data.audit);
    }
  } catch (error) { showToast(error.message); }
}

$("clinicianApproveButton").addEventListener("click", async () => {
  await whileBusy($("clinicianApproveButton"), "Saving approval…", approveCurrentAction);
  $("clinicianApproveButton").disabled = !clinicianAction;
});

$("patientForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const button = $("patientForm").querySelector("button");
  whileBusy(button, "Creating…", async () => {
    try {
      const result = await api("/api/patients", {
        method: "POST",
        body: JSON.stringify({ name: $("newPatientName").value })
      });
      $("newPatientName").value = "";
      $("recordStatus").textContent = `Created fictional patient ${result.patient.name} · ${result.patient.id} · inbox ${result.patient.inboxId}`;
      const data = await api("/api/data");
      populateReportPatients(data.patients);
    } catch (error) { showToast(error.message); }
  });
});

$("reportForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const button = $("reportForm").querySelector("button");
  whileBusy(button, "Saving…", async () => {
    try {
      const result = await api("/api/reports", {
        method: "POST",
        body: JSON.stringify({
          patientId: $("newReportPatient").value,
          title: $("newReportTitle").value,
          details: $("newReportDetails").value,
          requiresClinicianReview: $("newReportReview").checked
        })
      });
      $("reportForm").reset();
      $("recordStatus").textContent = `Created report ${result.report.id} for patient ${result.report.patientId}.`;
      populateReportPatients((await api("/api/data")).patients);
    } catch (error) { showToast(error.message); }
  });
});

refreshDemoAccounts().catch((error) => showToast(error.message));
