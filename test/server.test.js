const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createLabGuard } = require("../server");

async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "labguard-test-"));
  const dataFile = path.join(dir, "state.json");
  let app = createLabGuard({ dataFile });
  await app.initialize();
  let server = app.server;
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let base = `http://127.0.0.1:${server.address().port}`;
  const login = async (accountId) => {
    const response = await fetch(`${base}/api/sign-in`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ accountId }) });
    return (await response.json()).token;
  };
  const agent = await login("agent-demo");
  const clinician = await login("clinician-demo");
  const patientA = await login("patient-a-demo");
  const patientB = await login("patient-b-demo");
  const call = (token, route, body) => fetch(`${base}/api/${route}`, {
    method: body !== undefined ? "POST" : "GET",
    headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dir, { recursive: true, force: true });
  });
  return {
    call, agent, clinician, patientA, patientB, dataFile,
    restart: async () => {
      await new Promise((resolve) => server.close(resolve));
      app = createLabGuard({ dataFile });
      await app.initialize();
      server = app.server;
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      base = `http://127.0.0.1:${server.address().port}`;
      return {
        agent: await login("agent-demo"),
        clinician: await login("clinician-demo"),
        patientA: await login("patient-a-demo")
      };
    }
  };
}

const routine = (requestId, extra = {}) => ({
  requestId, reportId: "report-fake-501", patientId: "patient-fake-104", recipientId: "inbox-fake-104", ...extra
});
const flagged = (requestId, extra = {}) => ({
  requestId, reportId: "report-fake-502", patientId: "patient-fake-104", recipientId: "inbox-fake-104", ...extra
});
async function json(response) { return response.json(); }

test("wrong patient and unauthorised recipient are blocked", async (t) => {
  const f = await fixture(t);
  const wrong = await json(await f.call(f.agent, "preview", routine("wrong", { patientId: "patient-fake-208", recipientId: "inbox-fake-208" })));
  assert.equal(wrong.decision, "BLOCK");
  assert.match(wrong.rules.find((rule) => rule.rule === "report_ownership").explanation, /Ownership mismatch/);
  const denied = await json(await f.call(f.agent, "execute", routine("denied", { recipientId: "inbox-fake-208" })));
  assert.equal(denied.decision, "BLOCK");
  assert.equal((await json(await f.call(f.patientA, "inbox"))).inbox.length, 0);
});

test("malformed and unknown-record proposals are blocked", async (t) => {
  const f = await fixture(t);
  const malformed = await json(await f.call(f.agent, "execute", null));
  assert.equal(malformed.decision, "BLOCK");
  assert.equal((await json(await f.call(f.agent, "preview", {
    requestId: "unknown-report", reportId: "missing-report", patientId: "patient-fake-104", recipientId: "inbox-fake-104"
  }))).decision, "BLOCK");
  assert.equal((await json(await f.call(f.patientA, "inbox"))).inbox.length, 0);
});

test("approval is required and cannot override identity failures", async (t) => {
  const f = await fixture(t);
  const proposal = flagged("review-1");
  assert.equal((await json(await f.call(f.agent, "preview", proposal))).decision, "REVIEW_REQUIRED");
  assert.equal((await json(await f.call(f.agent, "execute", proposal))).decision, "REVIEW_REQUIRED");
  assert.equal((await json(await f.call(f.agent, "execute", proposal))).decision, "REVIEW_REQUIRED");
  assert.equal((await json(await f.call(f.agent, "data"))).audit.filter((entry) => entry.decision === "REVIEW_REQUIRED").length, 1);
  const invalidApproval = await f.call(f.clinician, "approve", flagged("bad-approval", { patientId: "patient-fake-208", recipientId: "inbox-fake-208" }));
  assert.equal(invalidApproval.status, 409);
  assert.equal((await json(await f.call(f.patientA, "inbox"))).inbox.length, 0);
  assert.equal((await f.call(f.agent, "approve", proposal)).status, 403);
  assert.equal((await f.call(f.clinician, "approve", proposal)).status, 200);
  assert.equal((await json(await f.call(f.agent, "preview", proposal))).decision, "ALLOW");
  assert.equal((await json(await f.call(f.agent, "execute", proposal))).decision, "ALLOW");
});

test("pending clinician review survives restart and can then be delivered", async (t) => {
  const f = await fixture(t);
  const proposal = flagged("review-restart");
  assert.equal((await json(await f.call(f.agent, "preview", proposal))).decision, "REVIEW_REQUIRED");
  const restarted = await f.restart();
  assert.equal((await json(await f.call(restarted.clinician, "data"))).pendingActions.length, 1);
  assert.equal((await f.call(restarted.clinician, "approve", proposal)).status, 200);
  assert.equal((await json(await f.call(restarted.agent, "execute", proposal))).decision, "ALLOW");
  assert.equal((await json(await f.call(restarted.patientA, "inbox"))).inbox.length, 1);
});

test("delivery, retries, changed request IDs and concurrent executions are idempotent", async (t) => {
  const f = await fixture(t);
  const proposal = routine("delivery-1");
  assert.equal((await json(await f.call(f.agent, "preview", proposal))).decision, "ALLOW");
  const results = await Promise.all(Array.from({ length: 8 }, () => f.call(f.agent, "execute", proposal).then(json)));
  assert.equal(results.filter((item) => item.deliveryId).length, 8);
  const inbox = await json(await f.call(f.patientA, "inbox"));
  assert.equal(inbox.inbox.length, 1);
  const changed = await f.call(f.agent, "execute", routine("delivery-1", { recipientId: "inbox-fake-208" }));
  assert.equal(changed.status, 409);
  const duplicate = await json(await f.call(f.agent, "execute", routine("delivery-new-id")));
  assert.equal(duplicate.decision, "BLOCK");
  assert.match(duplicate.rules.find((rule) => rule.rule === "not_already_delivered").explanation, /Already delivered/);
  assert.equal((await json(await f.call(f.patientA, "inbox"))).inbox.length, 1);
});

test("roles, inbox isolation, and state persist across server restart", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.call(f.patientA, "execute", routine("forbidden"))).status, 403);
  assert.equal((await f.call(f.agent, "inbox")).status, 403);
  await f.call(f.agent, "execute", routine("persist-1"));
  assert.equal((await json(await f.call(f.patientB, "inbox"))).inbox.length, 0);
  const restarted = await f.restart();
  assert.equal((await json(await f.call(restarted.patientA, "inbox"))).inbox.length, 1);
  const retried = await json(await f.call(restarted.agent, "execute", routine("persist-1")));
  assert.equal(retried.decision, "ALLOW");
  assert.equal((await json(await f.call(restarted.patientA, "inbox"))).inbox.length, 1);
});
