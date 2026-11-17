# LabGuard

### Check the action before the report reaches the patient.

LabGuard is a working prototype that checks proposed lab-result deliveries against patient records and clinic rules. Before a report is delivered, it checks four things:

- Does this report belong to the selected patient?
- Is the selected inbox authorised for that patient?
- Has the required clinician approval been given?
- Has this report already been delivered?

A failed check stops delivery and explains why. An approved action delivers the report to the intended patient's inbox. Retrying a completed delivery does not create another copy.

**Built by:** Mayowa Olawumi
**Project:** LabGuard
**Entry:** Individual
**Hackathon PROJECT_ID:** Not provided; add it from the event portal.

## The African use case

The intended setting is a small clinic in South Africa, Nigeria or another African country introducing automated lab-result delivery.

Consider a clinic with two patients whose names look similar. An automated assistant selects a report belonging to patient A but proposes delivering it to patient B. A well-written message would not fix that mistake: the delivery itself must be checked against the clinic's records.

LabGuard demonstrates that checkpoint. It validates the report, patient and recipient before anything reaches the patient inbox. Where a report requires clinician review, delivery waits for approval of the exact proposed action.

The aim is to make a small, understandable safety control available around an automated workflow. The prototype runs locally without paid APIs or external services. Its usefulness in real clinics still needs to be tested with laboratory staff and clinicians.

## Why I built it

This project brings together my background in biomedical technology, security engineering and backend systems.

In production software, retries, permissions and human approvals affect whether an automated workflow behaves correctly. I wanted to apply those same engineering principles to a concrete healthcare problem: making sure a laboratory report reaches the intended patient through an authorised action.

## What works end to end

The app supports records created through its own forms; the demonstration does not depend on preloaded scenarios.

1. A clinician creates fictional patients and their inboxes.
2. The clinician creates a report linked to one patient and chooses whether review is required.
3. The simulated agent proposes a delivery using a saved report, patient and inbox.
4. Server-side checks evaluate the proposed action.
5. A clinician approves the exact action when review is required.
6. A permitted action writes the report to the correct patient's inbox.
7. The patient signs in and reads the report.
8. Repeated delivery attempts leave a single inbox item.

Staff can inspect the audit history to understand how an action was handled.

## How the checks work

| Check | Behaviour |
| --- | --- |
| Patient identity | Blocks a proposal when the report belongs to a different patient. |
| Recipient permission | Blocks delivery to an inbox that is not authorised for the selected patient. |
| Clinician approval | Holds review-required actions until the exact action is approved. Approval does not override an identity or recipient mismatch. |
| Duplicate delivery | Prevents another inbox item when an already completed delivery is retried, including with a new request ID. |

Preview and execution share the same guard logic. Execution checks the action again on the server; a preview result does not grant permission to deliver.

Patient API sessions can retrieve only their own inbox.

## What is simulated

The active mode is **Manual proposal mode**.

The simulated agent lets the demonstrator select and edit a proposed action using saved records. No model credentials are configured, and no live AI model generates these proposals.

The guard checks, approval workflow, local inbox delivery and persistence are implemented. Delivery means writing a report into this application's patient inbox. The prototype does not send email or SMS, or connect to an EHR or laboratory information system.

Optional seeded scenarios use the same application logic as records created through the forms.

## Run locally

Requires **Node.js 18 or newer**.

No packages or external services are required. There is no `npm install` step.

```sh
git clone https://github.com/codewithmayor/labguard-africa-clinic.git
cd labguard-africa-clinic
npm start
```

Open **http://127.0.0.1:3000**.

In another terminal, run the tests:

```sh
npm test
```

## Create your own demonstration records

Use fictional information throughout.

1. Sign in as **Demo clinician**.
2. Create two fictional patients. Each receives a patient ID and inbox ID.
3. Create a report for patient A using synthetic report text.
4. Select **Clinician review required**.
5. Switch to **Simulated agent** and select the saved report.
6. Try a proposal using patient B, then try patient A with the wrong inbox.
7. Correct the proposal, obtain clinician approval and execute it.
8. Sign in as patient A to view the delivered report.

Saved patients appear as sign-in choices. These account choices are for demonstrating roles; they are not production authentication.

## One-minute live demonstration

Prepare the two fictional patients and the review-required report before presenting.

| Time | Demonstration |
| --- | --- |
| 0–10 seconds | Explain the clinic problem and identify the proposal generator as simulated. |
| 10–25 seconds | Attempt wrong-patient and wrong-recipient deliveries. Show both failed checks and zero new inbox deliveries. |
| 25–40 seconds | Correct the proposal, show that approval is required, approve it as clinician and execute as agent. |
| 40–50 seconds | Open patient A's inbox and show the delivered report. |
| 50–60 seconds | Retry the delivery. Show that only one inbox item exists and inspect the audit history. |

## How I kept tokens low

- I kept the Copilot build focused on one delivery action using Node.js built-ins.
- I reused one guard for preview and execution, reducing duplicated implementation work.
- I made targeted changes to the existing app instead of repeatedly regenerating it.

These describe my build approach. The submitted Copilot usage screenshot provides the actual usage evidence. Manual proposal mode also uses no model tokens at runtime; that is separate from the tokens used to build the application.

## Storage and limitations

Demo records persist in `data/labguard.json`, which is ignored by Git. Sessions are held in memory, so users must sign in again after a server restart.

This is a fictional-data hackathon prototype. It has not been clinically validated and must not be used with real patient information.

Before clinical deployment, it would need production authentication, privacy and security review, durable storage suitable for multiple server processes, real system integrations, and validation with healthcare professionals.

The current demonstration checks delivery permissions and workflow rules. It does not interpret laboratory results or decide what clinical care a patient needs.

## Submission checklist

- [x] Confirm the GitHub repository is publicly accessible.
- [ ] Replace the `PROJECT_ID` placeholder.
- [ ] Capture the genuine GitHub Copilot `/usage` screenshot.
- [x] Prepare the fictional records and rehearse the one-minute demo.
- [ ] Submit once as an individual before the confirmed deadline.

Submission: https://hackathon-project-submission.vercel.app
