const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomBytes, createHash } = require("node:crypto");

const ROOT = __dirname;
const DATA_FILE = path.join(ROOT, "data", "labguard.json");
const DEMO_ACCOUNTS = {
  "agent-demo": { id: "agent-demo", label: "Demo agent", role: "agent" },
  "clinician-demo": { id: "clinician-demo", label: "Dr. Nia Example (demo)", role: "clinician" },
  "patient-a-demo": { id: "patient-a-demo", label: "Ama Example (patient A)", role: "patient", patientId: "patient-fake-104" },
  "patient-b-demo": { id: "patient-b-demo", label: "Tunde Example (patient B)", role: "patient", patientId: "patient-fake-208" }
};

function seedState() {
  return {
    patients: {
      "patient-fake-104": { id: "patient-fake-104", name: "Ama Example", inboxId: "inbox-fake-104" },
      "patient-fake-208": { id: "patient-fake-208", name: "Tunde Example", inboxId: "inbox-fake-208" }
    },
    reports: {
      "report-fake-501": {
        id: "report-fake-501", version: 1, patientId: "patient-fake-104",
        title: "Routine blood panel", date: "2026-10-12", requiresClinicianReview: false,
        summary: "All demonstration values are within the fictional reference range.",
        details: "Synthetic demonstration report. No real patient or clinical result."
      },
      "report-fake-502": {
        id: "report-fake-502", version: 1, patientId: "patient-fake-104",
        title: "Flagged result (clinician review)", date: "2026-10-13", requiresClinicianReview: true,
        summary: "A fictional flagged value requires clinician review before follow-up.",
        details: "Synthetic demonstration report. A clinician must review this fictional result."
      }
    },
    approvals: [],
    pendingActions: {},
    requests: {},
    deliveries: [],
    audit: []
  };
}

function actionFingerprint(action, reportVersion) {
  const payload = action && typeof action === "object" && !Array.isArray(action)
    ? Object.fromEntries(Object.keys(action).sort().map((key) => [key, action[key]]))
    : action;
  return createHash("sha256").update(JSON.stringify({ payload, reportVersion })).digest("hex");
}

function guardAction(state, action) {
  const rules = [];
  const valid = action && typeof action === "object" && !Array.isArray(action) &&
    Object.keys(action).every((key) => ["requestId", "reportId", "patientId", "recipientId"].includes(key)) &&
    ["requestId", "reportId", "patientId", "recipientId"].every((key) =>
      typeof action[key] === "string" && action[key].length > 0 && action[key].length <= 120
    );
  rules.push({
    rule: "valid_action",
    status: valid ? "ALLOW" : "BLOCK",
    explanation: valid ? "Action type and required identifiers are valid." : "Provide a valid DELIVER_REPORT action with all required identifiers."
  });
  if (!valid) {
    rules.push(
      { rule: "report_ownership", status: "BLOCK", explanation: "Report and patient identifiers could not be verified." },
      { rule: "recipient_permission", status: "BLOCK", explanation: "Recipient permission could not be verified." },
      { rule: "clinician_approval", status: "BLOCK", explanation: "Approval cannot be evaluated for an invalid action." },
      { rule: "not_already_delivered", status: "BLOCK", explanation: "Duplicate status cannot be evaluated for an invalid action." }
    );
    return { decision: "BLOCK", rules };
  }

  const report = state.reports[action.reportId];
  const patient = state.patients[action.patientId];
  const known = Boolean(report && patient);
  rules.push({
    rule: "known_records",
    status: known ? "ALLOW" : "BLOCK",
    explanation: known ? "Report and patient records exist." : "Unknown report or patient identifier."
  });
  const ownershipOk = Boolean(report && patient && report.patientId === patient.id);
  rules.push({
    rule: "report_ownership",
    status: ownershipOk ? "ALLOW" : "BLOCK",
    explanation: ownershipOk ? "The proposed patient owns this report." : "Ownership mismatch: the proposed patient does not own this report."
  });
  const recipientOk = Boolean(patient && patient.inboxId === action.recipientId);
  rules.push({
    rule: "recipient_permission",
    status: recipientOk ? "ALLOW" : "BLOCK",
    explanation: recipientOk ? "The recipient is this patient's authorised inbox." : "Recipient is not authorised for this patient's report."
  });

  let fingerprint;
  if (report) fingerprint = actionFingerprint(action, report.version);
  const approvalExists = Boolean(report && !report.requiresClinicianReview ||
    report && state.approvals.some((approval) =>
      approval.fingerprint === fingerprint && approval.reportVersion === report.version
    ));
  const approvalStatus = !report ? "BLOCK" : approvalExists ? "ALLOW" : "REVIEW_REQUIRED";
  rules.push({
    rule: "clinician_approval",
    status: approvalStatus,
    explanation: !report ? "Approval cannot be checked without a known report." :
      !report.requiresClinicianReview ? "This report does not require clinician approval." :
        approvalExists ? "A clinician approved this exact action and report version." :
          "Clinician approval is required for this report and exact proposed action."
  });

  const alreadyDelivered = Boolean(report && patient && state.deliveries.some((delivery) =>
    delivery.reportId === report.id && delivery.patientId === patient.id && delivery.recipientId === action.recipientId
  ));
  rules.push({
    rule: "not_already_delivered",
    status: alreadyDelivered ? "BLOCK" : "ALLOW",
    explanation: alreadyDelivered ? "Already delivered: this report is in the authorised inbox." : "No prior delivery exists for this report and recipient."
  });

  const blocked = rules.some((rule) => rule.status === "BLOCK");
  const review = rules.some((rule) => rule.status === "REVIEW_REQUIRED");
  return { decision: blocked ? "BLOCK" : review ? "REVIEW_REQUIRED" : "ALLOW", rules, fingerprint, reportVersion: report?.version };
}

function createLabGuard({ dataFile = DATA_FILE } = {}) {
  const sessions = new Map();
  let state;
  let queue = Promise.resolve();

  async function persist(next) {
    await fs.mkdir(path.dirname(dataFile), { recursive: true });
    const temporary = `${dataFile}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600 });
    await fs.rename(temporary, dataFile);
  }

  async function initialize() {
    try {
      state = JSON.parse(await fs.readFile(dataFile, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      state = seedState();
      await persist(state);
    }
  }

  function mutate(operation) {
    const run = queue.then(async () => {
      const next = structuredClone(state);
      const result = await operation(next);
      await persist(next);
      state = next;
      return result;
    });
    queue = run.catch(() => {});
    return run;
  }

  function send(response, status, payload) {
    response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    response.end(JSON.stringify(payload));
  }

  async function readBody(request) {
    let raw = "";
    for await (const chunk of request) {
      raw += chunk;
      if (raw.length > 16_384) throw Object.assign(new Error("Request too large"), { status: 413 });
    }
    try { return JSON.parse(raw || "{}"); }
    catch { throw Object.assign(new Error("Malformed JSON body"), { status: 400 }); }
  }

  function authenticate(request, response, roles) {
    const token = (request.headers.authorization || "").replace(/^Bearer\s+/i, "");
    const session = sessions.get(token);
    if (!session) {
      send(response, 401, { error: "Sign in with a labelled demo account first." });
      return null;
    }
    if (roles && !roles.includes(session.role)) {
      send(response, 403, { error: "This demo account does not have permission for this action." });
      return null;
    }
    return session;
  }

  function auditEntry(account, action, decision, reasons, deliveryId) {
    return {
      timestamp: new Date().toISOString(),
      accountId: account.id,
      accountLabel: account.label,
      actionType: "DELIVER_REPORT",
      requestId: action.requestId,
      reportId: action.reportId,
      patientId: action.patientId,
      decision,
      reasons: reasons.filter((rule) => rule.status !== "ALLOW").map((rule) => rule.explanation),
      ...(deliveryId ? { deliveryId } : {})
    };
  }

  async function handle(request, response) {
    const url = new URL(request.url, "http://localhost");
    if (request.method === "GET" && url.pathname === "/api/health") return send(response, 200, { ok: true });
    if (request.method === "GET" && url.pathname === "/api/demo-accounts") {
      const accounts = Object.values(DEMO_ACCOUNTS).map(({ id, label, role }) => ({ id, label, role }));
      const seededPatientIds = new Set(Object.values(DEMO_ACCOUNTS).map((item) => item.patientId).filter(Boolean));
      for (const patient of Object.values(state.patients)) {
        if (!seededPatientIds.has(patient.id)) {
          accounts.push({ id: `patient:${patient.id}`, label: `${patient.name} (patient inbox)`, role: "patient" });
        }
      }
      return send(response, 200, { accounts });
    }
    if (request.method === "POST" && url.pathname === "/api/sign-in") {
      const body = await readBody(request);
      let account = DEMO_ACCOUNTS[body?.accountId];
      if (!account && typeof body?.accountId === "string" && body.accountId.startsWith("patient:")) {
        const patient = state.patients[body.accountId.slice("patient:".length)];
        if (patient) account = { id: body.accountId, label: `${patient.name} (patient inbox)`, role: "patient", patientId: patient.id };
      }
      if (!account) return send(response, 400, { error: "Choose one of the labelled demo accounts." });
      const token = randomBytes(32).toString("hex");
      sessions.set(token, account);
      return send(response, 200, { token, account });
    }
    if (request.method === "POST" && url.pathname === "/api/sign-out") {
      const token = (request.headers.authorization || "").replace(/^Bearer\s+/i, "");
      sessions.delete(token);
      return send(response, 200, { ok: true });
    }
    if (request.method === "GET" && url.pathname === "/api/data") {
      const account = authenticate(request, response);
      if (!account) return;
      if (account.role === "patient") {
        const inbox = state.deliveries.filter((item) => item.patientId === account.patientId);
        return send(response, 200, { account, inbox });
      }
      return send(response, 200, {
        account,
        patients: Object.values(state.patients),
        reports: Object.values(state.reports),
        audit: state.audit.slice(-50).reverse(),
        ...(account.role === "clinician" ? {
          pendingActions: Object.values(state.pendingActions).filter((item) => item.status === "pending")
        } : {})
      });
    }
    if (request.method === "POST" && url.pathname === "/api/patients") {
      if (!authenticate(request, response, ["clinician"])) return;
      const body = await readBody(request);
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      if (!name || name.length > 80) return send(response, 400, { error: "Enter a fictional patient name up to 80 characters." });
      const patient = await mutate((next) => {
        let suffix;
        do { suffix = randomBytes(4).toString("hex"); }
        while (next.patients[`patient-fake-${suffix}`]);
        const record = { id: `patient-fake-${suffix}`, name, inboxId: `inbox-fake-${suffix}` };
        next.patients[record.id] = record;
        return record;
      });
      return send(response, 201, { patient });
    }
    if (request.method === "POST" && url.pathname === "/api/reports") {
      if (!authenticate(request, response, ["clinician"])) return;
      const body = await readBody(request);
      const title = typeof body?.title === "string" ? body.title.trim() : "";
      const details = typeof body?.details === "string" ? body.details.trim() : "";
      if (!title || title.length > 100 || !details || details.length > 4000 ||
          typeof body?.requiresClinicianReview !== "boolean" || typeof body?.patientId !== "string") {
        return send(response, 400, { error: "Provide a fictional report title, text, patient and review setting." });
      }
      const report = await mutate((next) => {
        if (!next.patients[body.patientId]) return null;
        let id;
        do { id = `report-fake-${randomBytes(4).toString("hex")}`; }
        while (next.reports[id]);
        const record = {
          id, version: 1, patientId: body.patientId, title, date: new Date().toISOString().slice(0, 10),
          requiresClinicianReview: body.requiresClinicianReview,
          summary: details.length > 180 ? `${details.slice(0, 177)}...` : details,
          details
        };
        next.reports[id] = record;
        return record;
      });
      if (!report) return send(response, 400, { error: "Select a saved patient record." });
      return send(response, 201, { report });
    }
    if (request.method === "POST" && url.pathname === "/api/preview") {
      if (!authenticate(request, response, ["agent"])) return;
      const action = await readBody(request);
      const current = guardAction(state, action);
      if (current.decision !== "REVIEW_REQUIRED" ||
          typeof action?.requestId !== "string" || action.requestId.length > 120) {
        return send(response, 200, current);
      }
      const result = await mutate((next) => {
        const evaluation = guardAction(next, action);
        if (evaluation.decision === "REVIEW_REQUIRED") {
          next.pendingActions[action.requestId] = {
            action,
            fingerprint: evaluation.fingerprint,
            reportVersion: evaluation.reportVersion,
            status: "pending",
            createdAt: new Date().toISOString()
          };
        }
        return evaluation;
      });
      return send(response, 200, result);
    }
    if (request.method === "POST" && url.pathname === "/api/execute") {
      const account = authenticate(request, response, ["agent"]);
      if (!account) return;
      const action = await readBody(request);
      const result = await mutate((next) => {
        const validation = guardAction(next, action);
        if (typeof action?.requestId === "string" && action.requestId.length <= 120) {
          const prior = next.requests[action.requestId];
          const submittedFingerprint = actionFingerprint(action, validation.reportVersion ?? null);
          if (prior && prior.fingerprint !== submittedFingerprint) {
            return { status: 409, body: { error: "Request ID was already used with a different payload." } };
          }
          if (prior && prior.outcome.decision !== "REVIEW_REQUIRED") {
            return { status: 200, body: prior.outcome };
          }
          if (prior && validation.decision === "REVIEW_REQUIRED") {
            return { status: 200, body: prior.outcome };
          }
        }
        let deliveryId;
        if (validation.decision === "ALLOW") {
          deliveryId = `delivery-${randomBytes(8).toString("hex")}`;
          const report = next.reports[action.reportId];
          next.deliveries.push({
            id: deliveryId,
            reportId: report.id,
            reportVersion: report.version,
            title: report.title,
            date: report.date,
            summary: report.summary,
            details: report.details,
            patientId: action.patientId,
            recipientId: action.recipientId,
            deliveredAt: new Date().toISOString()
          });
        }
        const outcome = {
          decision: validation.decision,
          rules: validation.rules,
          requestId: action?.requestId,
          ...(deliveryId ? { deliveryId, message: "Report delivered to the authorised synthetic inbox." } : {})
        };
        const fingerprint = actionFingerprint(action, validation.reportVersion ?? null);
        if (typeof action?.requestId === "string" && action.requestId.length <= 120) {
          next.requests[action.requestId] = { fingerprint, outcome };
          if (validation.decision === "REVIEW_REQUIRED") {
            next.pendingActions[action.requestId] = {
              action,
              fingerprint,
              reportVersion: validation.reportVersion,
              status: "pending",
              createdAt: new Date().toISOString()
            };
          } else if (validation.decision === "ALLOW" && next.pendingActions[action.requestId]) {
            next.pendingActions[action.requestId].status = "delivered";
          }
        }
        next.audit.push(auditEntry(account, action || {}, validation.decision, validation.rules, deliveryId));
        return { status: 200, body: outcome };
      });
      return send(response, result.status, result.body);
    }
    if (request.method === "POST" && url.pathname === "/api/approve") {
      const account = authenticate(request, response, ["clinician"]);
      if (!account) return;
      const action = await readBody(request);
      const result = await mutate((next) => {
        const validation = guardAction(next, action);
        if (validation.decision !== "REVIEW_REQUIRED") {
          return { status: 409, body: { error: "Only an eligible review-required action can be approved.", ...validation } };
        }
        const pending = next.pendingActions[action.requestId];
        if (!pending || pending.status !== "pending" || pending.fingerprint !== validation.fingerprint ||
            pending.reportVersion !== validation.reportVersion) {
          return { status: 409, body: { error: "This exact action is not awaiting clinician review." } };
        }
        if (next.approvals.some((item) => item.fingerprint === validation.fingerprint && item.reportVersion === validation.reportVersion)) {
          return { status: 200, body: { approved: true, message: "This exact action is already approved." } };
        }
        next.approvals.push({
          fingerprint: validation.fingerprint,
          reportVersion: validation.reportVersion,
          requestId: action.requestId,
          reportId: action.reportId,
          patientId: action.patientId,
          recipientId: action.recipientId,
          approvedBy: account.id,
          approvedAt: new Date().toISOString()
        });
        pending.status = "approved";
        next.audit.push(auditEntry(account, action, "APPROVED", validation.rules));
        return { status: 200, body: { approved: true, message: "Exact action approved for this report version." } };
      });
      return send(response, result.status, result.body);
    }
    if (request.method === "GET" && url.pathname === "/api/audit") {
      if (!authenticate(request, response, ["agent", "clinician"])) return;
      return send(response, 200, { audit: state.audit.slice(-100).reverse() });
    }
    if (request.method === "GET" && url.pathname === "/api/inbox") {
      const account = authenticate(request, response, ["patient"]);
      if (!account) return;
      return send(response, 200, {
        inbox: state.deliveries.filter((item) => item.patientId === account.patientId)
      });
    }
    if (request.method === "GET" && (url.pathname === "/" || url.pathname.startsWith("/public/"))) {
      const relative = url.pathname === "/" ? "public/index.html" : url.pathname.slice(1);
      const file = path.join(ROOT, relative);
      if (!file.startsWith(path.join(ROOT, "public") + path.sep)) return send(response, 404, { error: "Not found" });
      try {
        const content = await fs.readFile(file);
        const type = file.endsWith(".css") ? "text/css" : file.endsWith(".js") ? "text/javascript" : "text/html";
        response.writeHead(200, { "content-type": `${type}; charset=utf-8` });
        response.end(content);
      } catch {
        send(response, 404, { error: "Not found" });
      }
      return;
    }
    send(response, 404, { error: "Not found" });
  }

  const server = http.createServer((request, response) => {
    handle(request, response).catch((error) => {
      send(response, error.status || 500, { error: error.status ? error.message : "Server error." });
    });
  });
  return { server, initialize };
}

if (require.main === module) {
  const app = createLabGuard();
  app.initialize().then(() => {
    const host = process.env.HOST || "127.0.0.1";
    const port = Number(process.env.PORT || 3000);
    app.server.listen(port, host, () => console.log(`LabGuard running at http://${host}:${port}`));
  }).catch((error) => {
    console.error("Could not initialise LabGuard:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { createLabGuard, guardAction };
