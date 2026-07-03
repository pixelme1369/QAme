import { createPool } from "./pool.js";
import * as scorecards from "./repos/scorecards.js";

/**
 * Seeds the first account and the v1 comprehensive scorecard: compliance
 * (40%), soft skills (25%), sales/outcome (35%), with auto-fail rules on the
 * critical compliance criteria. Idempotent — safe to re-run.
 *
 * SEED_ACCOUNT_EXTERNAL_ID must match the {account_id} segment of the GCS
 * recording paths for the client being onboarded.
 */
async function main(): Promise<void> {
  const externalId = process.env.SEED_ACCOUNT_EXTERNAL_ID;
  const accountName = process.env.SEED_ACCOUNT_NAME ?? "Primary Account";
  if (!externalId) throw new Error("SEED_ACCOUNT_EXTERNAL_ID is required");

  const db = createPool();

  const accRes = await db.query<{ id: string }>(
    `INSERT INTO accounts (external_id, name) VALUES ($1, $2)
     ON CONFLICT (external_id) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [externalId, accountName],
  );
  const accountId = accRes.rows[0]!.id;
  console.log(`account ${externalId} -> ${accountId}`);

  const existing = await scorecards.getActive(db, accountId);
  if (existing) {
    console.log(`active scorecard already present (v${existing.version}); not reseeding`);
    await db.end();
    return;
  }

  const templateId = await scorecards.publishVersion(db, {
    accountId,
    name: "Comprehensive Call QA",
    createdBy: null,
    categories: [
      {
        name: "Compliance & Script Adherence",
        weight: 40,
        sortOrder: 0,
        criteria: [
          {
            name: "Recording disclosure",
            guidance:
              "The agent must state, near the start of the call, that the call is being recorded or monitored. Pass only if an explicit disclosure is present.",
            scoringType: "pass_fail",
            weight: 1,
            isAutoFail: true,
            sortOrder: 0,
          },
          {
            name: "Identity and company disclosure",
            guidance:
              "The agent states their own name and the company they are calling on behalf of within the opening of the call.",
            scoringType: "pass_fail",
            weight: 1,
            isAutoFail: false,
            sortOrder: 1,
          },
          {
            name: "No prohibited claims or promises",
            guidance:
              "The agent must not guarantee outcomes, quote unauthorized prices or savings, claim government affiliation, or promise anything outside the approved script. Fail if any prohibited claim or fabricated promise is made.",
            scoringType: "pass_fail",
            weight: 1,
            isAutoFail: true,
            sortOrder: 2,
          },
          {
            name: "Do-not-call / opt-out honored",
            guidance:
              "If the customer asks to be removed from the list, not be called again, or says any equivalent of 'stop calling', the agent must acknowledge it and confirm the request without pushback. Pass if no such request occurred, or it occurred and was honored. Fail only when the request occurred and the agent ignored or resisted it.",
            scoringType: "pass_fail",
            weight: 1,
            isAutoFail: true,
            sortOrder: 3,
          },
          {
            name: "Script adherence",
            guidance:
              "How closely the agent followed the required call flow: opening, qualification, presentation, close. 100 = full flow in order; deduct for skipped or reordered required elements.",
            scoringType: "scale",
            weight: 1,
            isAutoFail: false,
            sortOrder: 4,
          },
        ],
      },
      {
        name: "Agent Soft Skills",
        weight: 25,
        sortOrder: 1,
        criteria: [
          {
            name: "Professional tone",
            guidance:
              "Courteous and composed throughout, including under pushback. Deduct for interrupting, arguing, sarcasm, or audible frustration.",
            scoringType: "scale",
            weight: 1,
            isAutoFail: false,
            sortOrder: 0,
          },
          {
            name: "Active listening",
            guidance:
              "The agent responds to what the customer actually said: acknowledges statements, does not ask for information already given, adapts rather than reading past the customer.",
            scoringType: "scale",
            weight: 1,
            isAutoFail: false,
            sortOrder: 1,
          },
          {
            name: "Clarity and pacing",
            guidance:
              "Speech is clear and unhurried; the customer never has to ask the agent to repeat or slow down. Deduct for rushed disclosures or mumbled required language.",
            scoringType: "scale",
            weight: 1,
            isAutoFail: false,
            sortOrder: 2,
          },
        ],
      },
      {
        name: "Sales & Outcome Quality",
        weight: 35,
        sortOrder: 2,
        criteria: [
          {
            name: "Needs discovery",
            guidance:
              "The agent asked qualifying questions to understand the customer's situation before presenting, rather than pitching blind.",
            scoringType: "scale",
            weight: 1,
            isAutoFail: false,
            sortOrder: 0,
          },
          {
            name: "Objection handling",
            guidance:
              "Objections are acknowledged and addressed with relevant, truthful responses. 100 = every objection handled well; 0 = objections ignored or steamrolled. Score 100 if no objections arose and the flow was handled correctly.",
            scoringType: "scale",
            weight: 1,
            isAutoFail: false,
            sortOrder: 1,
          },
          {
            name: "Close or next-step execution",
            guidance:
              "The agent asked for the sale/appointment or secured a concrete next step where the conversation supported it. Deduct for ending calls with interest on the table and no attempt to advance.",
            scoringType: "scale",
            weight: 1,
            isAutoFail: false,
            sortOrder: 2,
          },
          {
            name: "Accurate wrap-up",
            guidance:
              "Any commitments stated in the wrap-up (appointment time, callback, transfer) match what the customer actually agreed to. Fail if the agent recorded or stated an outcome the customer did not agree to.",
            scoringType: "pass_fail",
            weight: 1,
            isAutoFail: false,
            sortOrder: 3,
          },
        ],
      },
    ],
  });
  console.log(`published scorecard template ${templateId} (v1, active)`);
  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
