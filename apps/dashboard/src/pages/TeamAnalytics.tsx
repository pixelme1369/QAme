import { useEffect, useState } from "react";
import { get } from "../api/client.js";
import type { CategoryBreakdown, OutcomeCount, Overview, TrendPoint } from "../api/types.js";
import { useAccountId } from "../account.js";
import { ScoreBadge } from "../components/ScoreBadge.js";
import { TrendTable } from "../components/TrendTable.js";

export function TeamAnalytics(): JSX.Element {
  const accountId = useAccountId();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [categories, setCategories] = useState<CategoryBreakdown[]>([]);
  const [outcomes, setOutcomes] = useState<OutcomeCount[]>([]);

  useEffect(() => {
    if (!accountId) return;
    void get<Overview>("/analytics/overview", { accountId }).then(setOverview);
    void get<TrendPoint[]>("/analytics/trend", { accountId }).then(setTrend);
    void get<CategoryBreakdown[]>("/analytics/categories", { accountId }).then(setCategories);
    void get<OutcomeCount[]>("/analytics/outcomes", { accountId }).then(setOutcomes);
  }, [accountId]);

  return (
    <div>
      <header className="page-header">
        <h1>Team Analytics</h1>
        <span className="muted">last 30 days</span>
      </header>

      {overview && (
        <div className="stat-row">
          <div className="stat">
            <span className="stat-value">{overview.calls_total}</span>
            <span className="stat-label">calls ingested</span>
          </div>
          <div className="stat">
            <span className="stat-value">{overview.calls_scored}</span>
            <span className="stat-label">scored</span>
          </div>
          <div className="stat">
            <span className="stat-value">{overview.avg_score ?? "—"}</span>
            <span className="stat-label">avg score</span>
          </div>
          <div className="stat">
            <span className="stat-value">{overview.auto_fail_rate ?? 0}%</span>
            <span className="stat-label">auto-fail rate</span>
          </div>
          <div className="stat" title="Rising override rate is the AI-drift signal: review rubric wording or model.">
            <span className="stat-value">{overview.override_rate ?? 0}%</span>
            <span className="stat-label">manager override rate</span>
          </div>
        </div>
      )}

      <div className="panel-row">
        <div className="panel wide">
          <h3>Daily score trend</h3>
          <TrendTable points={trend} />
        </div>
        <div className="panel">
          <h3>Category breakdown</h3>
          <table className="data-table">
            <tbody>
              {categories.map((c) => (
                <tr key={c.category_name}>
                  <td>{c.category_name}</td>
                  <td>
                    <ScoreBadge score={c.avg_score} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3>Outcome distribution</h3>
          <table className="data-table">
            <tbody>
              {outcomes.map((o) => (
                <tr key={o.outcome}>
                  <td>{o.outcome.replaceAll("_", " ")}</td>
                  <td>{o.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
