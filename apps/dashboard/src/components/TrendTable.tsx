import type { TrendPoint } from "../api/types.js";

/** Compact daily trend with an inline score bar — no chart library needed. */
export function TrendTable({ points }: { points: TrendPoint[] }): JSX.Element {
  if (points.length === 0) return <p className="muted">No scored calls in range.</p>;
  return (
    <table className="data-table trend">
      <tbody>
        {points.map((p) => (
          <tr key={p.day}>
            <td className="muted">{p.day}</td>
            <td className="bar-cell">
              <div className="bar" style={{ width: `${p.avg_score ?? 0}%` }} />
            </td>
            <td>{p.avg_score ?? "—"}</td>
            <td className="muted">{p.calls_scored} calls</td>
            <td className="muted">{p.auto_fail_rate ?? 0}% AF</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
