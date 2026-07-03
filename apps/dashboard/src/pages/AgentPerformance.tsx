import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { get } from "../api/client.js";
import type { CategoryBreakdown, LeaderboardRow, OutcomeCount, TrendPoint } from "../api/types.js";
import { useAccountId } from "../account.js";
import { ScoreBadge } from "../components/ScoreBadge.js";
import { TrendTable } from "../components/TrendTable.js";

export function AgentPerformance(): JSX.Element {
  const accountId = useAccountId();
  const { id: agentId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [board, setBoard] = useState<LeaderboardRow[]>([]);
  const [detail, setDetail] = useState<{
    agent: { full_name: string };
    trend: TrendPoint[];
    categories: CategoryBreakdown[];
    outcomes: OutcomeCount[];
    coachingNotes: Array<{ id: string; note: string; status: string; created_at: string }>;
  } | null>(null);

  useEffect(() => {
    if (!accountId) return;
    void get<LeaderboardRow[]>("/analytics/leaderboard", { accountId }).then(setBoard);
  }, [accountId]);

  useEffect(() => {
    if (!agentId) {
      setDetail(null);
      return;
    }
    void get<typeof detail>(`/analytics/agents/${agentId}`).then(setDetail);
  }, [agentId]);

  return (
    <div>
      <header className="page-header">
        <h1>Agent Performance</h1>
        <span className="muted">last 30 days</span>
      </header>

      <table className="data-table">
        <thead>
          <tr>
            <th>Agent</th>
            <th>Calls scored</th>
            <th>Avg score</th>
            <th>Auto-fail rate</th>
            <th>Critical flags</th>
            <th>Open coaching</th>
          </tr>
        </thead>
        <tbody>
          {board.map((row) => (
            <tr
              key={row.agent_id}
              className={row.agent_id === agentId ? "selected" : ""}
              onClick={() => navigate(`/agents/${row.agent_id}`)}
              style={{ cursor: "pointer" }}
            >
              <td>{row.agent_name}</td>
              <td>{row.calls_scored}</td>
              <td>
                <ScoreBadge score={row.avg_score} />
              </td>
              <td>{row.auto_fail_rate !== null ? `${row.auto_fail_rate}%` : "—"}</td>
              <td>{row.critical_flags}</td>
              <td>{row.coaching_open}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {detail && (
        <section className="agent-detail">
          <h2>{detail.agent.full_name}</h2>
          <div className="panel-row">
            <div className="panel">
              <h3>Score trend</h3>
              <TrendTable points={detail.trend} />
            </div>
            <div className="panel">
              <h3>Category breakdown</h3>
              <table className="data-table">
                <tbody>
                  {detail.categories.map((c) => (
                    <tr key={c.category_name}>
                      <td>{c.category_name}</td>
                      <td>
                        <ScoreBadge score={c.avg_score} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="panel">
              <h3>Outcomes</h3>
              <table className="data-table">
                <tbody>
                  {detail.outcomes.map((o) => (
                    <tr key={o.outcome}>
                      <td>{o.outcome.replaceAll("_", " ")}</td>
                      <td>{o.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <h3>Coaching notes</h3>
          <ul className="note-list">
            {detail.coachingNotes.map((n) => (
              <li key={n.id}>
                <span className={`status status-${n.status}`}>{n.status}</span> {n.note}{" "}
                <span className="muted">({new Date(n.created_at).toLocaleDateString()})</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
