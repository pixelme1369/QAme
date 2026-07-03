import type { Db } from "../pool.js";
import type { TranscriptRow, UtteranceRow } from "../types.js";

export interface NewUtterance {
  idx: number;
  speaker: "agent" | "customer" | "unknown";
  rawSpeakerLabel: string;
  startMs: number;
  endMs: number;
  text: string;
  confidence: number | null;
}

export interface NewTranscript {
  callId: string;
  providerTranscriptId: string;
  language: string | null;
  fullText: string;
  audioDurationSeconds: number | null;
  confidence: number | null;
  agentSpeakerLabel: string | null;
  utterances: NewUtterance[];
}

/** Persists transcript + utterances atomically. Idempotent on call_id. */
export async function insert(db: Db, t: NewTranscript): Promise<TranscriptRow | null> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const res = await client.query<TranscriptRow>(
      `INSERT INTO transcripts
         (call_id, provider_transcript_id, language, full_text,
          audio_duration_seconds, confidence, agent_speaker_label)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (call_id) DO NOTHING
       RETURNING *`,
      [
        t.callId,
        t.providerTranscriptId,
        t.language,
        t.fullText,
        t.audioDurationSeconds,
        t.confidence,
        t.agentSpeakerLabel,
      ],
    );
    const row = res.rows[0];
    if (!row) {
      await client.query("ROLLBACK");
      return null;
    }
    for (const u of t.utterances) {
      await client.query(
        `INSERT INTO utterances
           (transcript_id, idx, speaker, raw_speaker_label, start_ms, end_ms, text, confidence)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [row.id, u.idx, u.speaker, u.rawSpeakerLabel, u.startMs, u.endMs, u.text, u.confidence],
      );
    }
    await client.query("COMMIT");
    return row;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function getByCallId(db: Db, callId: string): Promise<TranscriptRow | null> {
  const res = await db.query<TranscriptRow>(
    `SELECT * FROM transcripts WHERE call_id = $1`,
    [callId],
  );
  return res.rows[0] ?? null;
}

export async function utterances(db: Db, transcriptId: string): Promise<UtteranceRow[]> {
  const res = await db.query<UtteranceRow>(
    `SELECT * FROM utterances WHERE transcript_id = $1 ORDER BY idx`,
    [transcriptId],
  );
  return res.rows;
}

/**
 * Manual speaker correction from the dashboard: swaps agent/customer on
 * every utterance and records the transcript as manually attributed.
 */
export async function swapSpeakers(db: Db, transcriptId: string): Promise<void> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE utterances SET speaker = CASE speaker
         WHEN 'agent' THEN 'customer'
         WHEN 'customer' THEN 'agent'
         ELSE speaker END
       WHERE transcript_id = $1`,
      [transcriptId],
    );
    await client.query(
      `UPDATE transcripts SET attribution_method = 'manual' WHERE id = $1`,
      [transcriptId],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
