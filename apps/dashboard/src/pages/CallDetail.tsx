import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { get, post } from "../api/client.js";
import type { CallDetailResponse, CriterionScore } from "../api/types.js";
import { useAuth } from "../auth.js";
import { ScoreBadge, fmtMs, num } from "../components/ScoreBadge.js";

/**
 * Call Detail: audio synced to the speaker-labeled transcript, the full
 * scorecard with AI rationale + evidence (click-to-seek), auto-fail called
 * out, and manager override with mandatory justification.
 */
export function CallDetail(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { me } = useAuth();
  const [data, setData] = useState<CallDetailResponse | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [activeMs, setActiveMs] = useState(0);
  const [noteText, setNoteText] = useState("");
  const audioRef = useRef<HTMLAudioElement>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setData(await get<CallDetailResponse>(`/calls/${id}`));
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!id) return;
    void post<{ url: string }>(`/calls/${id}/audio-url`)
      .then((r) => setAudioUrl(r.url))
      .catch(() => setAudioUrl(null));
  }, [id]);

  const seek = (ms: number): void => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = ms / 1000;
    void el.play();
  };

  if (!data) return <div className="muted">Loading…</div>;
  const { call, utterances, result, criterionScores, flags, notes } = data;

  const byCategory = new Map<string, CriterionScore[]>();
  for (const cs of criterionScores) {
    const list = byCategory.get(cs.category_name) ?? [];
    list.push(cs);
    byCategory.set(cs.category_name, list);
  }

  return (
    <div>
      <header className="page-header">
        <h1>
          Call · {call.phone_number} · {new Date(call.recorded_at).toLocaleString()}
        </h1>
        {result && (
          <ScoreBadge
            score={num(result.override_score) ?? num(result.overall_score)}
            autoFailed={result.override_auto_failed ?? result.auto_failed}
            overridden={result.override_score !== null}
          />
        )}
      </header>

      {result?.auto_failed && (
        <div className="callout callout-fail">
          <strong>Auto-fail.</strong> A critical compliance rule was breached — see the
          highlighted criteria below.
        </div>
      )}
      {result?.override_score !== null && result?.override_reason && (
        <div className="callout callout-info">
          <strong>Manager override:</strong> score {result.override_score}, outcome{" "}
          {result.override_outcome}. Reason: {result.override_reason}. The original AI score (
          {result.overall_score}) is retained above.
        </div>
      )}

      {audioUrl ? (
        <audio
          ref={audioRef}
          controls
          src={audioUrl}
          className="audio-player"
          onTimeUpdate={(e) => setActiveMs(e.currentTarget.currentTime * 1000)}
        />
      ) : (
        <p className="muted">Audio unavailable.</p>
      )}

      <div className="detail-grid">
        <section className="transcript">
          <h2>
            Transcript{" "}
            <button
              className="link"
              title="Swap agent/customer labels if misattributed"
              onClick={async () => {
                if (!id) return;
                await post(`/calls/${id}/swap-speakers`);
                await load();
              }}
            >
              swap speakers
            </button>
          </h2>
          {utterances.map((u) => (
            <div
              key={u.id}
              className={`utterance speaker-${u.speaker} ${
                activeMs >= u.start_ms && activeMs < u.end_ms ? "active" : ""
              }`}
              onClick={() => seek(u.start_ms)}
            >
              <span className="ts">{fmtMs(u.start_ms)}</span>
              <span className="who">{u.speaker}</span>
              <span>{u.text}</span>
            </div>
          ))}
          {utterances.length === 0 && <p className="muted">No transcript yet ({call.status}).</p>}
        </section>

        <section className="scorecard">
          {result && (
            <>
              <h2>Scorecard</h2>
              <p className="muted">
                {result.ai_model} · prompt {result.prompt_version} · outcome:{" "}
                <strong>{result.outcome.replaceAll("_", " ")}</strong>
              </p>
              <p>{result.call_summary}</p>
              {result.category_scores.map((cs) => (
                <div key={cs.categoryId} className="category">
                  <div className="category-head">
                    <strong>{cs.name}</strong>
                    <span className="muted">weight {cs.weight}</span>
                    <ScoreBadge score={cs.score} />
                  </div>
                  {(byCategory.get(cs.name) ?? []).map((crit) => (
                    <div
                      key={crit.id}
                      className={`criterion ${
                        crit.is_auto_fail && crit.passed === false ? "criterion-autofail" : ""
                      }`}
                    >
                      <div className="criterion-head">
                        <span>
                          {crit.criterion_name}
                          {crit.is_auto_fail && <em className="muted"> (critical)</em>}
                        </span>
                        {crit.scoring_type === "pass_fail" ? (
                          <span className={`badge ${crit.passed ? "badge-good" : "badge-fail"}`}>
                            {crit.passed ? "PASS" : "FAIL"}
                          </span>
                        ) : (
                          <ScoreBadge score={num(crit.score)} />
                        )}
                      </div>
                      <p className="rationale">{crit.rationale}</p>
                      {crit.evidence_quote && (
                        <blockquote
                          className="evidence"
                          onClick={() =>
                            crit.evidence_start_ms !== null && seek(crit.evidence_start_ms)
                          }
                        >
                          “{crit.evidence_quote}”
                          {crit.evidence_start_ms !== null && (
                            <span className="ts"> ▸ {fmtMs(crit.evidence_start_ms)}</span>
                          )}
                        </blockquote>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
          {!result && <p className="muted">Not scored yet ({call.status}).</p>}

          {flags.length > 0 && (
            <>
              <h2>Flags</h2>
              <ul className="flag-list">
                {flags.map((f) => (
                  <li key={f.id} className={`flag flag-${f.severity}`}>
                    <strong>{f.label}</strong>
                    {f.detail && <span className="muted"> — {f.detail}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}

          {result && me!.role !== "analyst" && <OverridePanel callId={call.id} onDone={load} />}

          <h2>Coaching</h2>
          <ul className="note-list">
            {notes.map((n) => (
              <li key={n.id}>
                <span className={`status status-${n.status}`}>{n.status}</span> {n.note}
              </li>
            ))}
          </ul>
          {call.agent_id && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                if (!noteText.trim() || !id) return;
                await post(`/calls/${id}/coaching-notes`, { note: noteText.trim(), assignedTo: null });
                setNoteText("");
                await load();
              }}
            >
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add a coaching note for this agent…"
              />
              <button type="submit">Add note</button>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}

function OverridePanel({ callId, onDone }: { callId: string; onDone: () => Promise<void> }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [score, setScore] = useState("");
  const [autoFailed, setAutoFailed] = useState(false);
  const [outcome, setOutcome] = useState("other");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <p>
        <button onClick={() => setOpen(true)}>Override score…</button>
      </p>
    );
  }
  return (
    <form
      className="override-panel"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          await post(`/calls/${callId}/override`, {
            score: Number(score),
            autoFailed,
            outcome,
            reason,
          });
          setOpen(false);
          await onDone();
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }}
    >
      <h3>Manager override</h3>
      <p className="muted">
        The AI score is preserved and the override is written to the audit log.
      </p>
      <label>
        Score (0–100)
        <input type="number" min={0} max={100} required value={score} onChange={(e) => setScore(e.target.value)} />
      </label>
      <label>
        <input type="checkbox" checked={autoFailed} onChange={(e) => setAutoFailed(e.target.checked)} /> Auto-fail
      </label>
      <label>
        Outcome
        <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
          {["sale", "appointment_set", "callback_scheduled", "not_interested", "do_not_call", "no_contact", "wrong_number", "customer_service", "other"].map((o) => (
            <option key={o} value={o}>
              {o.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      <label>
        Justification (required)
        <textarea required minLength={10} value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {error && <p className="error">{error}</p>}
      <div>
        <button type="submit">Save override</button>{" "}
        <button type="button" className="link" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}
