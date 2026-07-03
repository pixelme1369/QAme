export function ScoreBadge({
  score,
  autoFailed,
  overridden,
}: {
  score: number | null;
  autoFailed?: boolean | null;
  overridden?: boolean;
}): JSX.Element {
  if (score === null) return <span className="badge badge-muted">—</span>;
  const tier = autoFailed ? "fail" : score >= 85 ? "good" : score >= 65 ? "ok" : "low";
  return (
    <span className={`badge badge-${tier}`} title={overridden ? "manager override" : undefined}>
      {autoFailed ? "AUTO-FAIL" : score.toFixed(0)}
      {overridden ? "*" : ""}
    </span>
  );
}

export function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

export function fmtDuration(seconds: number | null): string {
  if (seconds === null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function fmtMs(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
