# LabGuard

I built LabGuard for a small clinic in South Africa or Nigeria to check patient identity, recipient permission, clinician approval and duplicate actions before automated lab-result delivery.

**PROJECT_ID:** `<add hackathon project ID>`

## Run

Requires Node.js 18 or newer. No packages or external services are required; there is no `npm install` step.

```sh
git clone https://github.com/codewithmayor/labguard-africa-clinic.git
cd labguard-africa-clinic
npm start
```

In another terminal, run the tests:

```sh
npm test
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000).

## Demo records and accounts

Sign in as **Demo clinician** to create two clearly fictional patients; each receives a fake patient ID and inbox ID. Create a report linked to one patient, enter synthetic report text, and choose whether clinician review is required. After switching accounts, each saved patient appears as a sign-in choice. Other labelled choices are **Simulated agent** and **Demo clinician**. The agent can select any saved report, patient and inbox from editable proposal suggestions. Seeded demo scenarios are optional examples and use the same guard, approval, delivery and audit code.

The active mode is **Manual proposal mode**: proposals are editable and simulated; no live model call is made. Guard checks, clinician approval, local delivery and persistence execute normally. At runtime, manual mode makes no model calls and uses no model tokens. Delivery writes the report into this application's local JSON-backed patient inbox, not email, SMS, an EHR or a laboratory system. Patient API sessions can retrieve only their own inbox.

## One-minute demonstration

Before presenting, use the clinician forms to prepare two fictional patients/inboxes and a report for patient A with **Clinician review required** selected.

- **0–10 seconds:** Explain the clinic's delivery-safety problem and that the agent is simulated with editable manual proposals.
- **10–25 seconds:** Submit wrong patient, then wrong recipient proposals; show the failed rules and zero inbox deliveries.
- **25–40 seconds:** Correct both IDs, preview the required review, approve the exact action as clinician, then execute as agent.
- **40–50 seconds:** Sign in as patient A and open the delivered report.
- **50–60 seconds:** Retry with the same and a new request ID; show one inbox item and the staff audit history.

## How I kept Copilot build tokens low

- I limited the scope to one action and Node.js built-ins.
- I reused the same guard for preview and execution.
- I reused existing tests and made targeted edits.

## Boundaries and submission

All records are fictional. Demo authentication is passwordless role switching, not identity verification. This prototype is not for clinical use: clinical validation, production authentication, privacy/security review, durable multi-process storage and real integrations are required first. Sessions are held in memory and must be re-created after restart; patient/report/inbox records remain in `data/labguard.json`, which is ignored by Git.

- [x] Public repository: https://github.com/codewithmayor/labguard-africa-clinic
- [ ] Replace the `PROJECT_ID` placeholder.
- [ ] Capture genuine usage evidence with the IDE `/usage` view.
- [ ] Submit my individual entry once.
