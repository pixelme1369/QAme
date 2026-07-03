import type { AaiUtterance } from "./assemblyai-client.js";

/**
 * Resolves which diarized speaker label is the agent — deterministically,
 * before scoring, so the AI never has to infer identity mid-analysis.
 *
 * Heuristic (outbound call-center audio):
 *   1. Phrase evidence — company/script phrases are agent speech; short
 *      answering phrases at call open ("hello?") are customer speech.
 *   2. Talk-ratio prior — agents drive scripted outbound calls, so the
 *      speaker with the larger share of words is the likelier agent.
 * The dashboard exposes a one-click swap for the rare misattribution.
 */

const AGENT_PHRASES = [
  "calling from",
  "calling on behalf of",
  "on behalf of",
  "my name is",
  "this call may be recorded",
  "call is being recorded",
  "recorded line",
  "how are you today",
  "is this a good time",
  "do i have your permission",
  "let me get you over to",
  "i can offer",
  "we can offer",
  "our company",
  "promotion",
  "no obligation",
];

const CUSTOMER_PHRASES = [
  "who is this",
  "who's calling",
  "not interested",
  "take me off",
  "stop calling",
  "don't call",
  "wrong number",
  "how did you get my number",
];

export interface AttributionResult {
  agentLabel: string | null;
  /** speaker label -> 'agent' | 'customer' | 'unknown' */
  roleFor(label: string): "agent" | "customer" | "unknown";
}

export function attributeSpeakers(utterances: AaiUtterance[]): AttributionResult {
  const labels = [...new Set(utterances.map((u) => u.speaker))];
  if (labels.length === 0) {
    return { agentLabel: null, roleFor: () => "unknown" };
  }
  if (labels.length === 1) {
    // Single diarized speaker (voicemail drop, dead air): treat as agent.
    const only = labels[0]!;
    return { agentLabel: only, roleFor: (l) => (l === only ? "agent" : "unknown") };
  }

  const score = new Map<string, number>(labels.map((l) => [l, 0]));
  const words = new Map<string, number>(labels.map((l) => [l, 0]));

  for (const u of utterances) {
    const text = u.text.toLowerCase();
    let s = score.get(u.speaker) ?? 0;
    for (const phrase of AGENT_PHRASES) if (text.includes(phrase)) s += 2;
    for (const phrase of CUSTOMER_PHRASES) if (text.includes(phrase)) s -= 2;
    score.set(u.speaker, s);
    words.set(u.speaker, (words.get(u.speaker) ?? 0) + text.split(/\s+/).length);
  }

  // Tie-break on talk share: +1 to the speaker with the most words.
  const byWords = [...words.entries()].sort((a, b) => b[1] - a[1]);
  const top = byWords[0];
  if (top) score.set(top[0], (score.get(top[0]) ?? 0) + 1);

  const ranked = [...score.entries()].sort((a, b) => b[1] - a[1]);
  const agentLabel = ranked[0]![0];
  return {
    agentLabel,
    roleFor: (l) => (l === agentLabel ? "agent" : "customer"),
  };
}
