/**
 * Populates a local database with realistic demo data for design review and
 * local development: agents, campaigns, two weeks of scored calls with
 * varied outcomes/scores/auto-fails, one fully transcribed showcase call,
 * coaching notes, and demo users.
 *
 * Prerequisites: migrate + seed (SEED_ACCOUNT_EXTERNAL_ID=dev-account) done.
 *
 *   DATABASE_URL=postgres://... npx tsx scripts/demo-data.mts
 */
import { createPool, calls, transcripts, scorecards, org } from "@qame/db";
import { validateScoringOutput, type ScoringOutput } from "@qame/scorecard-schema";
import { scoreCall } from "../apps/pipeline-service/src/tasks/score.js";
import type { ScoringClient } from "../apps/pipeline-service/src/qa/claude-client.js";

const db = createPool();
const account = await org.accountByExternalId(db, process.env.SEED_ACCOUNT_EXTERNAL_ID ?? "dev-account");
if (!account) throw new Error("run migrate + seed first");
const template = await scorecards.getActive(db, account.id);
if (!template) throw new Error("no active scorecard");

// --- users ---
await db.query(
  `INSERT INTO users (email, full_name, role) VALUES
     ('qa.admin@demo.dev', 'Dana Reyes', 'admin'),
     ('qa.manager@demo.dev', 'Marcus Cole', 'manager'),
     ('qa.analyst@demo.dev', 'Priya Nair', 'analyst')
   ON CONFLICT (email) DO NOTHING`,
);

// --- agents & campaigns ---
const agentNames = ["Alex Rivera", "Jordan Blake", "Sam Chen", "Taylor Brooks", "Morgan Diaz"];
const agentIds: string[] = [];
for (const [i, name] of agentNames.entries()) {
  const res = await db.query<{ id: string }>(
    `INSERT INTO agents (account_id, external_ref, full_name, email)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (account_id, external_ref) DO UPDATE SET full_name = EXCLUDED.full_name
     RETURNING id`,
    [account.id, `AGT-${100 + i}`, name, `${name.toLowerCase().replace(" ", ".")}@demo.dev`],
  );
  agentIds.push(res.rows[0]!.id);
}
const campaignIds: string[] = [];
for (const name of ["Energy Savings Q3", "Home Warranty Renewal"]) {
  const res = await db.query<{ id: string }>(
    `INSERT INTO campaigns (account_id, name) VALUES ($1, $2)
     ON CONFLICT (account_id, name) DO UPDATE SET is_active = true RETURNING id`,
    [account.id, name],
  );
  campaignIds.push(res.rows[0]!.id);
}

// --- deterministic pseudo-random so re-runs look the same ---
let seed = 42;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
function pick<T>(arr: T[]): T {
  return arr[Math.floor(rnd() * arr.length)]!;
}

const OUTCOMES = [
  "sale", "sale", "appointment_set", "appointment_set", "appointment_set",
  "callback_scheduled", "not_interested", "not_interested", "not_interested",
  "no_contact", "do_not_call", "other",
] as const;

const showcase = {
  utterances: [
    { sp: "agent", start: 300, text: "Hi, good afternoon — is this Chris?" },
    { sp: "customer", start: 2400, text: "Yeah, speaking. Who's this?" },
    { sp: "agent", start: 3800, text: "This is Jordan Blake calling from Brightline Energy on a recorded line. How are you today?" },
    { sp: "customer", start: 9200, text: "I'm alright. What's this about?" },
    { sp: "agent", start: 11000, text: "We're reaching out to homeowners in your area about the summer rate review. It takes about two minutes and there's no obligation — do you have a moment?" },
    { sp: "customer", start: 19500, text: "Two minutes, okay. But I'm not signing anything today." },
    { sp: "agent", start: 22800, text: "Completely fair, and you don't have to. Can I ask roughly what your monthly electric bill runs in the summer?" },
    { sp: "customer", start: 29900, text: "Usually around two hundred, two twenty." },
    { sp: "agent", start: 33000, text: "That's right in the range where the review helps. Based on usage like yours, the plan we're reviewing has been coming in about fifteen percent lower — I can't promise your exact number, that depends on your last twelve months." },
    { sp: "customer", start: 46700, text: "Hm. And what's the catch? Is there a contract?" },
    { sp: "agent", start: 50100, text: "Good question. It's a twelve-month term, no enrollment fee, and there's a thirty-day window to cancel without penalty. That's the part most people ask about." },
    { sp: "customer", start: 60300, text: "Alright. I'd want to see it in writing before I decide anything." },
    { sp: "agent", start: 64000, text: "Absolutely. What I can do is set a quick appointment with our review specialist — they'll walk you through the written comparison. Would tomorrow at ten or Thursday at two work better?" },
    { sp: "customer", start: 75800, text: "Thursday at two works." },
    { sp: "agent", start: 78100, text: "Thursday at two it is. You'll get a confirmation text with the specialist's name. Thanks for the time, Chris — enjoy your afternoon." },
    { sp: "customer", start: 85500, text: "Alright, thanks. Bye." },
  ],
  judge(crit: { name: string; scoringType: string }): { passed: boolean | null; score: number | null; rationale: string; quote: string | null; ms: number | null } {
    switch (crit.name) {
      case "Recording disclosure":
        return { passed: true, score: null, rationale: "The agent disclosed the recorded line in the opening.", quote: "This is Jordan Blake calling from Brightline Energy on a recorded line.", ms: 3800 };
      case "Identity and company disclosure":
        return { passed: true, score: null, rationale: "Name and company were stated within the first ten seconds.", quote: "This is Jordan Blake calling from Brightline Energy on a recorded line.", ms: 3800 };
      case "No prohibited claims or promises":
        return { passed: true, score: null, rationale: "Savings were framed as typical results with an explicit disclaimer, not a guarantee.", quote: "I can't promise your exact number, that depends on your last twelve months.", ms: 33000 };
      case "Do-not-call / opt-out honored":
        return { passed: true, score: null, rationale: "No opt-out request occurred on this call.", quote: null, ms: null };
      case "Script adherence":
        return { passed: null, score: 92, rationale: "Opening, qualification, presentation and close all present and in order; permission-to-continue question was slightly abbreviated.", quote: "It takes about two minutes and there's no obligation — do you have a moment?", ms: 11000 };
      case "Professional tone":
        return { passed: null, score: 95, rationale: "Courteous throughout, acknowledged hesitation without pushing back.", quote: "Completely fair, and you don't have to.", ms: 22800 };
      case "Active listening":
        return { passed: null, score: 90, rationale: "Responses built directly on the customer's answers, including the bill amount and the written-comparison request.", quote: "That's right in the range where the review helps.", ms: 33000 };
      case "Clarity and pacing":
        return { passed: null, score: 88, rationale: "Clear delivery; the customer never asked for repetition.", quote: "It's a twelve-month term, no enrollment fee, and there's a thirty-day window to cancel without penalty.", ms: 50100 };
      case "Needs discovery":
        return { passed: null, score: 85, rationale: "Asked about the summer bill before presenting; could have probed usage patterns further.", quote: "Can I ask roughly what your monthly electric bill runs in the summer?", ms: 22800 };
      case "Objection handling":
        return { passed: null, score: 93, rationale: "Handled the 'what's the catch' and 'in writing' objections directly and truthfully.", quote: "Good question. It's a twelve-month term, no enrollment fee...", ms: 50100 };
      case "Close or next-step execution":
        return { passed: null, score: 96, rationale: "Offered an alternative-choice close and secured a concrete appointment.", quote: "Would tomorrow at ten or Thursday at two work better?", ms: 64000 };
      case "Accurate wrap-up":
        return { passed: true, score: null, rationale: "The confirmed Thursday 2pm appointment matches the customer's words.", quote: "Thursday at two it is.", ms: 78100 };
      default:
        return { passed: crit.scoringType === "pass_fail" ? true : null, score: crit.scoringType === "scale" ? 85 : null, rationale: "Meets the rubric.", quote: null, ms: null };
    }
  },
};

function randomOutput(quality: number, forceAutoFail: boolean, outcome: string): ScoringOutput {
  const raw = {
    judgments: template!.categories.flatMap((cat) =>
      cat.criteria.map((cr) => {
        const isTheFail = forceAutoFail && cr.name === "No prohibited claims or promises";
        return {
          criterionId: cr.id,
          passed: cr.scoringType === "pass_fail" ? (isTheFail ? false : rnd() > 0.12 * (1.6 - quality)) : null,
          score: cr.scoringType === "scale" ? Math.round(Math.min(100, Math.max(20, quality * 78 + rnd() * 22))) : null,
          rationale: isTheFail
            ? "The agent guaranteed a specific 30% saving ('I can promise you'll save at least thirty percent'), which is a prohibited claim."
            : "Consistent with the rubric based on the transcript.",
          evidenceQuote: isTheFail ? "I can promise you'll save at least thirty percent on this plan." : "Representative line from the call.",
          evidenceStartMs: Math.floor(rnd() * 60000),
        };
      }),
    ),
    outcome,
    outcomeRationale: "Classified from the customer's closing statements.",
    callSummary:
      "Outbound rate-review call. The agent presented the current promotion and the customer's decision is reflected in the outcome classification.",
  };
  return validateScoringOutput(raw, template!);
}

// --- generate ~34 scored calls over the past 14 days ---
const now = Date.now();
let created = 0;
for (let i = 0; i < 34; i++) {
  const agentIdx = i % agentIds.length;
  const quality = [0.95, 1.0, 0.75, 0.9, 0.55][agentIdx]!; // per-agent skill profile
  const daysAgo = rnd() * 14;
  const recordedAt = new Date(now - daysAgo * 24 * 3600 * 1000);
  const ymd = recordedAt.toISOString().slice(0, 10);
  const compact = ymd.replaceAll("-", "") + "-" + recordedAt.toISOString().slice(11, 19).replaceAll(":", "");
  const phone = `1555${String(1000000 + Math.floor(rnd() * 8999999))}`;
  const objectPath = `dev-account/${ymd}/${compact}_${phone}-all.mp3`;

  const call = await calls.insertIfNew(db, {
    accountId: account.id,
    gcsObjectPath: objectPath,
    gcsBucket: "x5-clients",
    recordedAt,
    phoneNumber: phone,
  });
  if (!call) continue;
  created++;
  await calls.setAgent(db, call.id, agentIds[agentIdx]!);
  await db.query(`UPDATE calls SET campaign_id = $1 WHERE id = $2`, [pick(campaignIds), call.id]);
  await calls.transition(db, call.id, "received", "transcribing");

  const isShowcase = i === 0;
  const utts = isShowcase
    ? showcase.utterances
    : [
        { sp: "agent", start: 500, text: "Hi, this is a demo call transcript line for design review." },
        { sp: "customer", start: 4000, text: "Sure, go ahead." },
      ];
  await transcripts.insert(db, {
    callId: call.id,
    providerTranscriptId: `demo-${call.id}`,
    language: "en",
    fullText: utts.map((u) => u.text).join(" "),
    audioDurationSeconds: isShowcase ? 92 : 45 + Math.floor(rnd() * 300),
    confidence: 0.9 + rnd() * 0.08,
    agentSpeakerLabel: "A",
    utterances: utts.map((u, idx) => ({
      idx,
      speaker: u.sp as "agent" | "customer",
      rawSpeakerLabel: u.sp === "agent" ? "A" : "B",
      startMs: u.start,
      endMs: u.start + 2000,
      text: u.text,
      confidence: 0.93,
    })),
  });
  await calls.setDuration(db, call.id, isShowcase ? 92 : 120 + Math.floor(rnd() * 400));
  await calls.transition(db, call.id, "transcribing", "transcribed");

  const forceAutoFail = !isShowcase && rnd() < 0.12;
  const outcome = isShowcase ? "appointment_set" : pick([...OUTCOMES]);
  const output: ScoringOutput = isShowcase
    ? validateScoringOutput(
        {
          judgments: template.categories.flatMap((cat) =>
            cat.criteria.map((cr) => {
              const j = showcase.judge(cr);
              return {
                criterionId: cr.id,
                passed: j.passed,
                score: j.score,
                rationale: j.rationale,
                evidenceQuote: j.quote,
                evidenceStartMs: j.ms,
              };
            }),
          ),
          outcome: "appointment_set",
          outcomeRationale: "The customer explicitly confirmed the Thursday 2pm review appointment.",
          callSummary:
            "Outbound energy rate-review call. The agent disclosed the recorded line and company, qualified the customer's summer bill (~$210/mo), presented the plan with a truthful savings disclaimer, handled contract objections, and closed a Thursday 2pm specialist appointment.",
        },
        template,
      )
    : randomOutput(quality, forceAutoFail, outcome);

  const stub = { score: async () => ({ output, model: "demo-fixture" }) } as unknown as ScoringClient;
  await scoreCall(db, stub, call.id);
}

// --- a few coaching notes ---
const mgr = await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'qa.manager@demo.dev'`);
const flagged = await db.query<{ call_id: string; agent_id: string }>(
  `SELECT c.id AS call_id, c.agent_id FROM calls c
    JOIN call_scorecard_results r ON r.call_id = c.id
   WHERE r.auto_failed AND c.agent_id IS NOT NULL LIMIT 3`,
);
for (const [i, row] of flagged.rows.entries()) {
  await db.query(
    `INSERT INTO coaching_notes (call_id, agent_id, created_by, note, status)
     SELECT $1, $2, $3, $4, $5
     WHERE NOT EXISTS (SELECT 1 FROM coaching_notes WHERE call_id = $1)`,
    [
      row.call_id,
      row.agent_id,
      mgr.rows[0]!.id,
      "Review the prohibited-claims section of the script with this agent — savings must always carry the twelve-month usage disclaimer.",
      i === 0 ? "in_progress" : "open",
    ],
  );
}

console.log(`demo data ready: ${created} calls created`);
await db.end();
