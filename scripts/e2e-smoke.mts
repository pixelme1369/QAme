/**
 * End-to-end smoke test against a live Postgres: exercises ingest
 * idempotency, state machine, transcript persistence, the scoring task with
 * a stubbed AI client, result/flag persistence, the queue query, and the
 * audited manager override.
 *
 * Prerequisites: migrations applied and seed run with
 * SEED_ACCOUNT_EXTERNAL_ID=dev-account. Then:
 *
 *   DATABASE_URL=postgres://... npx tsx scripts/e2e-smoke.mts
 *
 * Runs in CI against a clean Postgres service on every push.
 */
import assert from "node:assert/strict";
import { createPool, calls, transcripts, scorecards, results, org } from "@qame/db";
import type { ScoringOutput } from "@qame/scorecard-schema";
import { validateScoringOutput } from "@qame/scorecard-schema";
import { scoreCall } from "../apps/pipeline-service/src/tasks/score.js";
import type { ScoringClient } from "../apps/pipeline-service/src/qa/claude-client.js";

const db = createPool();

const accountExternalId = process.env.SEED_ACCOUNT_EXTERNAL_ID ?? "dev-account";
const account = await org.accountByExternalId(db, accountExternalId);
assert(account, "seeded account exists");

// --- ingest (idempotent) ---
// Unique per run so the script can be re-run against a non-clean database.
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15).replace(/^(\d{8})/, "$1-");
const path = `${accountExternalId}/2026-07-03/${stamp}_15550001111-all.mp3`;
const call = await calls.insertIfNew(db, {
  accountId: account.id,
  gcsObjectPath: path,
  gcsBucket: "x5-clients",
  recordedAt: new Date("2026-07-03T10:15:00Z"),
  phoneNumber: "15550001111",
});
assert(call, "first insert returns the row");
assert.equal(await calls.insertIfNew(db, { accountId: account.id, gcsObjectPath: path, gcsBucket: "x5-clients", recordedAt: new Date(), phoneNumber: "x" }), null, "duplicate insert is a no-op");

// --- state machine ---
assert.equal(await calls.transition(db, call.id, "received", "transcribing"), true);
assert.equal(await calls.transition(db, call.id, "received", "transcribing"), false, "double transition rejected");

// --- transcript ---
const inserted = await transcripts.insert(db, {
  callId: call.id,
  providerTranscriptId: `smoke-${call.id}`,
  language: "en",
  fullText: "agent and customer talk",
  audioDurationSeconds: 62,
  confidence: 0.93,
  agentSpeakerLabel: "A",
  utterances: [
    { idx: 0, speaker: "agent", rawSpeakerLabel: "A", startMs: 0, endMs: 4000, text: "Hi, my name is Jordan calling from Acme on a recorded line.", confidence: 0.95 },
    { idx: 1, speaker: "customer", rawSpeakerLabel: "B", startMs: 4200, endMs: 6000, text: "Okay, what's this about?", confidence: 0.92 },
    { idx: 2, speaker: "agent", rawSpeakerLabel: "A", startMs: 6100, endMs: 12000, text: "We're reviewing energy plans in your area, no obligation.", confidence: 0.94 },
  ],
});
assert(inserted, "transcript inserted");
assert.equal(await calls.transition(db, call.id, "transcribing", "transcribed"), true);

// --- scoring with a stubbed model client ---
const template = await scorecards.getActive(db, account.id);
assert(template, "active template");
const stubOutput: ScoringOutput = validateScoringOutput(
  {
    judgments: template.categories.flatMap((cat) =>
      cat.criteria.map((cr) => ({
        criterionId: cr.id,
        passed: cr.scoringType === "pass_fail" ? cr.name !== "No prohibited claims or promises" : null,
        score: cr.scoringType === "scale" ? 80 : null,
        rationale: "stubbed judgment",
        evidenceQuote: "Hi, my name is Jordan calling from Acme on a recorded line.",
        evidenceStartMs: 0,
      })),
    ),
    outcome: "not_interested",
    outcomeRationale: "stub",
    callSummary: "stubbed summary",
  },
  template,
);
const stubScorer = {
  score: async () => ({ output: stubOutput, model: "stub-model" }),
} as unknown as ScoringClient;

await scoreCall(db, stubScorer, call.id);

// --- assertions on the persisted result ---
const updated = await calls.getById(db, call.id);
assert.equal(updated!.status, "scored");
const result = await results.getByCallId(db, call.id);
assert(result, "result persisted");
assert.equal(result.auto_failed, true, "failed prohibited-claims criterion auto-fails the call");
assert.equal(result.outcome, "not_interested");
const critScores = await results.criterionScores(db, result.id);
assert.equal(critScores.length, template.categories.flatMap((c) => c.criteria).length, "one score per criterion");
const flags = await results.flagsForCall(db, call.id);
assert(flags.some((f) => f.severity === "critical" && f.label.startsWith("Auto-fail")), "critical auto-fail flag");

// --- queue query sees it ---
const queue = await calls.queue(db, { accountId: account.id, autoFailed: true, limit: 10, offset: 0 });
assert(queue.items.some((i) => i.id === call.id), "auto-fail filter finds the call");

// --- manager override path ---
const userRes = await db.query<{ id: string }>(
  `INSERT INTO users (email, full_name, role) VALUES ('smoke@test.dev', 'Smoke Manager', 'manager')
   ON CONFLICT (email) DO UPDATE SET role = 'manager' RETURNING id`,
);
const ok = await results.override(db, {
  callId: call.id,
  userId: userRes.rows[0]!.id,
  score: 55,
  autoFailed: false,
  outcome: "callback_scheduled",
  reason: "Disclosure was present but garbled in transcription.",
});
assert.equal(ok, true);
const overridden = await results.getByCallId(db, call.id);
assert.equal(Number(overridden!.override_score), 55);
assert.equal(Number(overridden!.overall_score) !== 55, true, "AI score untouched");
const audit = await db.query(`SELECT * FROM audit_log WHERE action = 'score_override'`);
assert((audit.rowCount ?? 0) >= 1, "override audit-logged");

console.log("E2E SMOKE: ALL ASSERTIONS PASSED");
await db.end();
