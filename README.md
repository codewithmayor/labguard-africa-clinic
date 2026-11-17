# LabGuard

LabGuard helps a small clinic in South Africa or Nigeria check patient identity, recipient permission, clinician approval and duplicate actions before automated lab-result delivery.

**PROJECT_ID:** `<add hackathon project ID>`

## Run

Requires Node.js 18 or newer. No packages or external services are required; there is no `npm install` step.

```sh
npm start
npm test
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

## Demo records and accounts

Sign in as **Demo clinician** to create two clearly fictional patients; each receives a fake patient ID and inbox ID. Create a report linked to one patient, enter synthetic report text, and choose whether clinician review is required. After switching accounts, each saved patient appears as a sign-in choice. The **Simulated agent** can select any saved report, patient and inbox from editable proposal suggestions. Seeded demo scenarios are optional examples and use the same guard, approval, delivery and audit code.

The active mode is **Manual proposal mode**: no model credentials are configured. The agent is simulated; there is no live model call. Delivery writes the report into this application's local JSON-backed patient inbox, not email, SMS, an EHR or a laboratory system. Patient API sessions can retrieve only their own inbox.

## One-minute demonstration

Before presenting, use the clinician forms to prepare two fictional patients/inboxes and a report for patient A with **Clinician review required** selected.

- **0–10 seconds:** Explain the clinic's delivery-safety problem and that the agent is simulated with editable manual proposals.
- **10–25 seconds:** Submit wrong patient, then wrong recipient proposals; show the failed rules and zero inbox deliveries.
- **25–40 seconds:** Correct both IDs, preview the required review, approve the exact action as clinician, then execute as agent.
- **40–50 seconds:** Sign in as patient A and open the delivered report.
- **50–60 seconds:** Retry with the same and a new request ID; show one inbox item and the staff audit history.

## How we kept tokens low

- **Copilot build:** limited scope to one action and Node built-ins.
- **Copilot build:** reused one guard for preview and execution.
- **App runtime:** manual mode makes no model calls or model-token use.

## Boundaries and submission

This is a fictional-data prototype, not for clinical use. Clinical validation, production authentication, privacy/security review, durable multi-process storage and real integrations are required before any clinical use. Sessions are held in memory and must be re-created after restart; persisted demo records remain in `data/labguard.json`, which is ignored by Git.

- [ ] Publish a public repository and replace the `PROJECT_ID` placeholder.
- [ ] Capture genuine usage evidence with the IDE `/usage` view.
- [ ] Submit once for the team.
