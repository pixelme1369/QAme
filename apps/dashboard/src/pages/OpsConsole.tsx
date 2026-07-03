import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get, post } from "../api/client.js";
import type { PipelineHealth, ProcessingError } from "../api/types.js";

/** Internal reliability view: pipeline state, stuck calls, error queue. */
export function OpsConsole(): JSX.Element {
  const [health, setHealth] = useState<PipelineHealth | null>(null);
  const [errors, setErrors] = useState<ProcessingError[]>([]);
  const [stuck, setStuck] = useState<Array<{ id: string; status: string; status_updated_at: string; gcs_object_path: string }>>([]);

  const load = useCallback(async () => {
    setHealth(await get<PipelineHealth>("/ops/health"));
    setErrors(await get<ProcessingError[]>("/ops/errors"));
    setStuck(await get<typeof stuck>("/ops/stuck-calls"));
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div>
      <header className="page-header">
        <h1>Ops Console</h1>
        <span className="muted">auto-refreshes every 30s</span>
      </header>

      {health && (
        <div className="stat-row">
          {health.by_status.map((s) => (
            <div className="stat" key={s.status}>
              <span className="stat-value">{s.count}</span>
              <span className="stat-label">{s.status}</span>
            </div>
          ))}
          <div className="stat">
            <span className="stat-value">{health.scored_last_24h}</span>
            <span className="stat-label">scored (24h)</span>
          </div>
          <div className={`stat ${health.failed_last_24h > 0 ? "stat-bad" : ""}`}>
            <span className="stat-value">{health.failed_last_24h}</span>
            <span className="stat-label">failed (24h)</span>
          </div>
          <div className={`stat ${health.unresolved_errors > 0 ? "stat-bad" : ""}`}>
            <span className="stat-value">{health.unresolved_errors}</span>
            <span className="stat-label">unresolved errors</span>
          </div>
        </div>
      )}

      <h2>Stuck calls (&gt;30 min in a transient state)</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>Call</th>
            <th>Status</th>
            <th>Since</th>
            <th>Recording</th>
          </tr>
        </thead>
        <tbody>
          {stuck.map((c) => (
            <tr key={c.id}>
              <td>
                <Link to={`/calls/${c.id}`}>{c.id.slice(0, 8)}</Link>
              </td>
              <td>
                <span className={`status status-${c.status}`}>{c.status}</span>
              </td>
              <td>{new Date(c.status_updated_at).toLocaleString()}</td>
              <td className="muted">{c.gcs_object_path}</td>
            </tr>
          ))}
          {stuck.length === 0 && (
            <tr>
              <td colSpan={4} className="muted center">
                Nothing stuck.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <h2>Processing errors</h2>
      <table className="data-table">
        <thead>
          <tr>
            <th>When</th>
            <th>Stage</th>
            <th>Code</th>
            <th>Message</th>
            <th>Call</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {errors.map((e) => (
            <tr key={e.id}>
              <td>{new Date(e.occurred_at).toLocaleString()}</td>
              <td>{e.stage}</td>
              <td>{e.error_code}</td>
              <td className="muted">{e.message}</td>
              <td>{e.call_id ? <Link to={`/calls/${e.call_id}`}>{e.call_id.slice(0, 8)}</Link> : "—"}</td>
              <td>
                <button
                  className="link"
                  onClick={async () => {
                    await post(`/ops/errors/${e.id}/resolve`);
                    await load();
                  }}
                >
                  resolve
                </button>
              </td>
            </tr>
          ))}
          {errors.length === 0 && (
            <tr>
              <td colSpan={6} className="muted center">
                No unresolved errors.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
