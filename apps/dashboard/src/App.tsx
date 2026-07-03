import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { useAuth } from "./auth.js";
import { get } from "./api/client.js";
import type { Account } from "./api/types.js";
import { AccountContext } from "./account.js";
import { CallQueue } from "./pages/CallQueue.js";
import { CallDetail } from "./pages/CallDetail.js";
import { AgentPerformance } from "./pages/AgentPerformance.js";
import { TeamAnalytics } from "./pages/TeamAnalytics.js";
import { ScorecardAdmin } from "./pages/ScorecardAdmin.js";
import { OpsConsole } from "./pages/OpsConsole.js";

export function App(): JSX.Element {
  const { me, signOut } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState<string>("");

  useEffect(() => {
    void get<Account[]>("/accounts").then((list) => {
      setAccounts(list);
      if (list.length > 0) setAccountId((prev) => prev || list[0]!.id);
    });
  }, []);

  return (
    <AccountContext.Provider value={accountId}>
      <div className="shell">
        <aside className="sidebar">
          <div className="brand">QAme</div>
          <nav>
            <NavLink to="/calls">Call Queue</NavLink>
            <NavLink to="/analytics">Team Analytics</NavLink>
            <NavLink to="/agents">Agent Performance</NavLink>
            {me!.role === "admin" && <NavLink to="/scorecards">Scorecards</NavLink>}
            {me!.role === "admin" && <NavLink to="/ops">Ops Console</NavLink>}
          </nav>
          <div className="sidebar-footer">
            {accounts.length > 1 && (
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
            <div className="whoami">
              <span>
                {me!.fullName} · {me!.role}
              </span>
              <button className="link" onClick={signOut}>
                Sign out
              </button>
            </div>
          </div>
        </aside>
        <main className="content">
          <Routes>
            <Route path="/" element={<Navigate to="/calls" replace />} />
            <Route path="/calls" element={<CallQueue />} />
            <Route path="/calls/:id" element={<CallDetail />} />
            <Route path="/analytics" element={<TeamAnalytics />} />
            <Route path="/agents" element={<AgentPerformance />} />
            <Route path="/agents/:id" element={<AgentPerformance />} />
            <Route path="/scorecards" element={<ScorecardAdmin />} />
            <Route path="/ops" element={<OpsConsole />} />
          </Routes>
        </main>
      </div>
    </AccountContext.Provider>
  );
}
