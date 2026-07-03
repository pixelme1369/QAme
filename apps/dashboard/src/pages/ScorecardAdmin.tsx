import { useCallback, useEffect, useState } from "react";
import type { ScorecardTemplate } from "@qame/scorecard-schema";
import { get, post } from "../api/client.js";
import type { ScorecardTemplateHead } from "../api/types.js";
import { useAccountId } from "../account.js";

/**
 * Scorecard Administration: versioned rubric editing without a deploy.
 * Publishing creates a new version and activates it; historical calls keep
 * the version they were scored against.
 */

interface DraftCriterion {
  name: string;
  guidance: string;
  scoringType: "pass_fail" | "scale";
  weight: number;
  isAutoFail: boolean;
}

interface DraftCategory {
  name: string;
  weight: number;
  criteria: DraftCriterion[];
}

export function ScorecardAdmin(): JSX.Element {
  const accountId = useAccountId();
  const [versions, setVersions] = useState<ScorecardTemplateHead[]>([]);
  const [active, setActive] = useState<ScorecardTemplate | null>(null);
  const [draft, setDraft] = useState<DraftCategory[] | null>(null);
  const [name, setName] = useState("Comprehensive Call QA");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!accountId) return;
    setVersions(await get<ScorecardTemplateHead[]>("/scorecards", { accountId }));
    try {
      const tpl = await get<ScorecardTemplate>("/scorecards/active", { accountId });
      setActive(tpl);
      setName(tpl.name);
    } catch {
      setActive(null);
    }
  }, [accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEditing = (): void => {
    setSaved(false);
    setDraft(
      active
        ? active.categories.map((c) => ({
            name: c.name,
            weight: c.weight,
            criteria: c.criteria.map((cr) => ({
              name: cr.name,
              guidance: cr.guidance,
              scoringType: cr.scoringType,
              weight: cr.weight,
              isAutoFail: cr.isAutoFail,
            })),
          }))
        : [{ name: "New category", weight: 100, criteria: [] }],
    );
  };

  const publish = async (): Promise<void> => {
    if (!draft) return;
    setError(null);
    try {
      await post("/scorecards/publish", {
        accountId,
        name,
        categories: draft.map((c, ci) => ({
          name: c.name,
          weight: c.weight,
          sortOrder: ci,
          criteria: c.criteria.map((cr, cri) => ({ ...cr, sortOrder: cri })),
        })),
      });
      setDraft(null);
      setSaved(true);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div>
      <header className="page-header">
        <h1>Scorecard Administration</h1>
        {active && (
          <span className="muted">
            active: {active.name} v{active.version}
          </span>
        )}
      </header>

      {saved && <div className="callout callout-info">New version published and activated.</div>}

      {!draft && (
        <>
          <p>
            <button onClick={startEditing}>
              {active ? "Edit as new version…" : "Create first scorecard…"}
            </button>
          </p>
          {active && <ReadOnlyTemplate template={active} />}
          <h2>Version history</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Version</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id}>
                  <td>{v.name}</td>
                  <td>v{v.version}</td>
                  <td>
                    <span className={`status status-${v.status}`}>{v.status}</span>
                  </td>
                  <td>{new Date(v.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {draft && (
        <div className="editor">
          <label>
            Scorecard name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          {draft.map((cat, ci) => (
            <div key={ci} className="category editor-category">
              <div className="category-head">
                <input
                  value={cat.name}
                  onChange={(e) =>
                    setDraft(update(draft, ci, (c) => ({ ...c, name: e.target.value })))
                  }
                />
                <label>
                  weight{" "}
                  <input
                    type="number"
                    min={1}
                    value={cat.weight}
                    onChange={(e) =>
                      setDraft(update(draft, ci, (c) => ({ ...c, weight: Number(e.target.value) })))
                    }
                  />
                </label>
                <button
                  className="link"
                  onClick={() => setDraft(draft.filter((_, i) => i !== ci))}
                >
                  remove category
                </button>
              </div>
              {cat.criteria.map((cr, cri) => (
                <div key={cri} className="criterion editor-criterion">
                  <input
                    placeholder="Criterion name"
                    value={cr.name}
                    onChange={(e) =>
                      setDraft(updateCrit(draft, ci, cri, (c) => ({ ...c, name: e.target.value })))
                    }
                  />
                  <textarea
                    placeholder="Rubric guidance — injected verbatim into the AI scoring prompt"
                    value={cr.guidance}
                    onChange={(e) =>
                      setDraft(updateCrit(draft, ci, cri, (c) => ({ ...c, guidance: e.target.value })))
                    }
                  />
                  <div className="criterion-controls">
                    <select
                      value={cr.scoringType}
                      onChange={(e) =>
                        setDraft(
                          updateCrit(draft, ci, cri, (c) => ({
                            ...c,
                            scoringType: e.target.value as "pass_fail" | "scale",
                            isAutoFail: e.target.value === "scale" ? false : c.isAutoFail,
                          })),
                        )
                      }
                    >
                      <option value="pass_fail">pass / fail</option>
                      <option value="scale">0–100 scale</option>
                    </select>
                    <label>
                      <input
                        type="checkbox"
                        disabled={cr.scoringType !== "pass_fail"}
                        checked={cr.isAutoFail}
                        onChange={(e) =>
                          setDraft(
                            updateCrit(draft, ci, cri, (c) => ({ ...c, isAutoFail: e.target.checked })),
                          )
                        }
                      />{" "}
                      auto-fail (zero tolerance)
                    </label>
                    <label>
                      weight{" "}
                      <input
                        type="number"
                        min={1}
                        value={cr.weight}
                        onChange={(e) =>
                          setDraft(
                            updateCrit(draft, ci, cri, (c) => ({ ...c, weight: Number(e.target.value) })),
                          )
                        }
                      />
                    </label>
                    <button
                      className="link"
                      onClick={() =>
                        setDraft(
                          update(draft, ci, (c) => ({
                            ...c,
                            criteria: c.criteria.filter((_, i) => i !== cri),
                          })),
                        )
                      }
                    >
                      remove
                    </button>
                  </div>
                </div>
              ))}
              <button
                className="link"
                onClick={() =>
                  setDraft(
                    update(draft, ci, (c) => ({
                      ...c,
                      criteria: [
                        ...c.criteria,
                        { name: "", guidance: "", scoringType: "scale", weight: 1, isAutoFail: false },
                      ],
                    })),
                  )
                }
              >
                + add criterion
              </button>
            </div>
          ))}
          <button
            className="link"
            onClick={() => setDraft([...draft, { name: "", weight: 10, criteria: [] }])}
          >
            + add category
          </button>
          {error && <p className="error">{error}</p>}
          <div className="editor-actions">
            <button onClick={() => void publish()}>Publish as new active version</button>{" "}
            <button className="link" onClick={() => setDraft(null)}>
              Discard
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function ReadOnlyTemplate({ template }: { template: ScorecardTemplate }): JSX.Element {
  return (
    <div>
      {template.categories.map((cat) => (
        <div key={cat.id} className="category">
          <div className="category-head">
            <strong>{cat.name}</strong>
            <span className="muted">weight {cat.weight}</span>
          </div>
          {cat.criteria.map((cr) => (
            <div key={cr.id} className="criterion">
              <div className="criterion-head">
                <span>
                  {cr.name}
                  {cr.isAutoFail && <em className="muted"> (auto-fail)</em>}
                </span>
                <span className="muted">{cr.scoringType.replaceAll("_", "/")}</span>
              </div>
              <p className="rationale">{cr.guidance}</p>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function update<T>(list: T[], index: number, fn: (item: T) => T): T[] {
  return list.map((item, i) => (i === index ? fn(item) : item));
}

function updateCrit(
  cats: DraftCategory[],
  ci: number,
  cri: number,
  fn: (c: DraftCriterion) => DraftCriterion,
): DraftCategory[] {
  return update(cats, ci, (cat) => ({ ...cat, criteria: update(cat.criteria, cri, fn) }));
}
