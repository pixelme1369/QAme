import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get } from "../api/client.js";
import type { Agent, CallQueueItem, Campaign } from "../api/types.js";
import { useAccountId } from "../account.js";
import { ScoreBadge, fmtDuration, num } from "../components/ScoreBadge.js";

const PAGE_SIZE = 50;

interface Filters {
  agentId: string;
  campaignId: string;
  outcome: string;
  autoFailed: string;
  flagType: string;
  minScore: string;
  maxScore: string;
}

const EMPTY: Filters = {
  agentId: "",
  campaignId: "",
  outcome: "",
  autoFailed: "",
  flagType: "",
  minScore: "",
  maxScore: "",
};

export function CallQueue(): JSX.Element {
  const accountId = useAccountId();
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(0);
  const [items, setItems] = useState<CallQueueItem[]>([]);
  const [total, setTotal] = useState(0);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!accountId) return;
    void get<Agent[]>("/agents", { accountId }).then(setAgents);
    void get<Campaign[]>("/campaigns", { accountId }).then(setCampaigns);
  }, [accountId]);

  const load = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      const res = await get<{ items: CallQueueItem[]; total: number }>("/calls", {
        accountId,
        agentId: filters.agentId || undefined,
        campaignId: filters.campaignId || undefined,
        outcome: filters.outcome || undefined,
        autoFailed: filters.autoFailed || undefined,
        flagType: filters.flagType || undefined,
        minScore: filters.minScore || undefined,
        maxScore: filters.maxScore || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      setItems(res.items);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [accountId, filters, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = (key: keyof Filters) => (e: React.ChangeEvent<HTMLSelectElement | HTMLInputElement>) => {
    setPage(0);
    setFilters((f) => ({ ...f, [key]: e.target.value }));
  };

  return (
    <div>
      <header className="page-header">
        <h1>Call Queue</h1>
        <span className="muted">{total} calls</span>
      </header>

      <div className="filter-bar">
        <select value={filters.agentId} onChange={set("agentId")}>
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.full_name}
            </option>
          ))}
        </select>
        <select value={filters.campaignId} onChange={set("campaignId")}>
          <option value="">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={filters.autoFailed} onChange={set("autoFailed")}>
          <option value="">Any result</option>
          <option value="true">Auto-failed</option>
          <option value="false">Not auto-failed</option>
        </select>
        <select value={filters.flagType} onChange={set("flagType")}>
          <option value="">Any flags</option>
          <option value="compliance">Compliance</option>
          <option value="soft_skill">Soft skill</option>
          <option value="outcome">Outcome</option>
          <option value="processing_error">Processing</option>
        </select>
        <select value={filters.outcome} onChange={set("outcome")}>
          <option value="">Any outcome</option>
          {["sale", "appointment_set", "callback_scheduled", "not_interested", "do_not_call", "no_contact", "other"].map(
            (o) => (
              <option key={o} value={o}>
                {o.replaceAll("_", " ")}
              </option>
            ),
          )}
        </select>
        <input type="number" placeholder="Min score" value={filters.minScore} onChange={set("minScore")} />
        <input type="number" placeholder="Max score" value={filters.maxScore} onChange={set("maxScore")} />
        <button className="link" onClick={() => setFilters(EMPTY)}>
          Clear
        </button>
      </div>

      <table className="data-table">
        <thead>
          <tr>
            <th>Recorded</th>
            <th>Agent</th>
            <th>Campaign</th>
            <th>Phone</th>
            <th>Duration</th>
            <th>Status</th>
            <th>Score</th>
            <th>Outcome</th>
            <th>Flags</th>
          </tr>
        </thead>
        <tbody>
          {items.map((c) => {
            const effective = num(c.override_score) ?? num(c.overall_score);
            return (
              <tr key={c.id}>
                <td>
                  <Link to={`/calls/${c.id}`}>{new Date(c.recorded_at).toLocaleString()}</Link>
                </td>
                <td>{c.agent_name ?? "—"}</td>
                <td>{c.campaign_name ?? "—"}</td>
                <td>{c.phone_number}</td>
                <td>{fmtDuration(c.duration_seconds)}</td>
                <td>
                  <span className={`status status-${c.status}`}>{c.status}</span>
                </td>
                <td>
                  <ScoreBadge
                    score={effective}
                    autoFailed={c.auto_failed}
                    overridden={c.override_score !== null}
                  />
                </td>
                <td>{c.outcome?.replaceAll("_", " ") ?? "—"}</td>
                <td>
                  {c.critical_flag_count > 0 && (
                    <span className="badge badge-fail">{c.critical_flag_count}!</span>
                  )}{" "}
                  {c.flag_count > 0 && <span className="muted">{c.flag_count}</span>}
                </td>
              </tr>
            );
          })}
          {items.length === 0 && !loading && (
            <tr>
              <td colSpan={9} className="muted center">
                No calls match these filters.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="pager">
        <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
          ‹ Prev
        </button>
        <span>
          Page {page + 1} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}
        </span>
        <button disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>
          Next ›
        </button>
      </div>
    </div>
  );
}
