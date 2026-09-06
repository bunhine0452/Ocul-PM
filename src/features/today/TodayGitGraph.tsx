import { useCallback, useEffect, useState } from "react";
import { commands, type GitGraphCommit } from "@/lib/bindings";
import { EmptyState } from "@/components/EmptyState";
import { GitBranch, RefreshCw, Tag, TriangleAlert } from "@/components/Icons";
import { computeGitGraph, type GraphRow } from "./gitGraph";
import { t } from "@/i18n";
import { relativeTime } from "@/lib/format";

// A VSCode-style commit graph on Today. Lanes are computed in gitGraph.ts; here
// we draw each row as a small SVG (pass-through verticals + converging/diverging
// edges + the commit node) beside the commit message, author, time, and refs.
// Clicking a commit opens it on GitHub in the default browser (when the repo has
// a GitHub remote).

const GRAPH_LIMIT = 40;
const LANE_W = 14;
const ROW_H = 34;
const NODE_R = 3.5;
const LANE_COLORS = ["#12a06b", "#2570e0", "#7c5cdb", "#e07b12", "#e0524b", "#0e9aa0"];
const laneColor = (c: number) => LANE_COLORS[((c % LANE_COLORS.length) + LANE_COLORS.length) % LANE_COLORS.length];

function relTime(unixSec: number): string {
  return relativeTime(unixSec, Date.now(), { beyondDays: 7 });
}

const cx = (lane: number) => lane * LANE_W + LANE_W / 2;

function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const my = (y1 + y2) / 2;
  return `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
}

function RowGraph({ row, width }: { row: GraphRow; width: number }) {
  const ncx = cx(row.nodeLane);
  const mid = ROW_H / 2;
  return (
    <svg width={width} height={ROW_H} style={{ flexShrink: 0, display: "block" }} aria-hidden="true">
      {row.through.map((t, i) => (
        <line key={`t${i}`} x1={cx(t.lane)} y1={0} x2={cx(t.lane)} y2={ROW_H} stroke={laneColor(t.color)} strokeWidth={1.5} opacity={0.85} />
      ))}
      {row.ups.map((u, i) => (
        <path key={`u${i}`} d={edgePath(cx(u.lane), 0, ncx, mid)} stroke={laneColor(u.color)} strokeWidth={1.5} fill="none" opacity={0.85} />
      ))}
      {row.downs.map((d, i) => (
        <path key={`d${i}`} d={edgePath(ncx, mid, cx(d.lane), ROW_H)} stroke={laneColor(d.color)} strokeWidth={1.5} fill="none" opacity={0.85} />
      ))}
      <circle cx={ncx} cy={mid} r={NODE_R} fill={laneColor(row.color)} stroke="var(--bg-window)" strokeWidth={1.5} />
    </svg>
  );
}

export function TodayGitGraph({ projectId, enabled }: { projectId: number; enabled: boolean }) {
  const [commits, setCommits] = useState<GitGraphCommit[] | null>(null);
  const [isRepo, setIsRepo] = useState(true);
  const [ghBase, setGhBase] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    const [graphRes, statusRes] = await Promise.all([
      commands.gitGraph(projectId, GRAPH_LIMIT),
      commands.gitStatus(projectId),
    ]);
    if (graphRes.status === "ok") {
      setCommits(graphRes.data);
      setIsRepo(true);
    } else {
      setCommits([]);
      setIsRepo(false);
    }
    // Find a GitHub remote so commits can be opened on the web.
    if (statusRes.status === "ok") {
      const gh = statusRes.data.remotes.find((r) => r.host === "github.com" && r.owner && r.repo);
      setGhBase(gh ? `https://github.com/${gh.owner}/${gh.repo}` : null);
    } else {
      setGhBase(null);
    }
    setLoading(false);
  }, [projectId, enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openCommit = (sha: string) => {
    if (!ghBase) return;
    void commands.openUrl(`${ghBase}/commit/${sha}`);
  };

  // Not a git repo → tell the user why the graph is empty (rather than silently
  // hiding it) — they asked to be informed.
  if (!isRepo) {
    return (
      <div className="card" style={{ marginTop: 16 }}>
        <div className="panel-head">
          <GitBranch size={16} color="var(--text-2)" />
          <h3>{t("today.git.title")}</h3>
        </div>
        <EmptyState align="start" style={{ padding: "18px 16px" }}>
          {t("today.git.notRepo")}
          <br />
          <span style={{ fontSize: 11, color: "var(--text-3)" }}>
            {t("today.git.notRepoHint")}
          </span>
        </EmptyState>
      </div>
    );
  }
  if (commits != null && commits.length === 0) return null; // repo but no commits yet

  const layout = commits ? computeGitGraph(commits) : null;
  const graphWidth = layout ? Math.max(LANE_W, layout.laneCount * LANE_W) : LANE_W;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="panel-head">
        <GitBranch size={16} color="var(--accent-text)" />
        <h3>{t("today.git.title")}</h3>
        {commits ? <span className="count">{commits.length}</span> : null}
        <button className="btn ghost sm right" onClick={() => void refresh()} disabled={loading} aria-label={t("today.git.refresh")} title={t("today.git.refresh")}>
          <RefreshCw size={13} />
        </button>
      </div>
      <div className="panel-body" style={{ maxHeight: 380, overflowY: "auto", padding: "4px 0" }}>
        {layout
          ? layout.rows.map((row) => (
              <div
                key={row.commit.sha}
                onClick={ghBase ? () => openCommit(row.commit.sha) : undefined}
                title={ghBase ? t("today.git.openOnGitHub") : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  height: ROW_H,
                  gap: 10,
                  padding: "0 14px 0 12px",
                  cursor: ghBase ? "pointer" : "default",
                }}
                className={ghBase ? "git-graph-row" : undefined}
              >
                <RowGraph row={row} width={graphWidth} />
                <div style={{ minWidth: 0, flex: 1, display: "flex", alignItems: "center", gap: 8 }}>
                  {row.commit.refs.map((r) => {
                    const isTag = /^v?\d+\.\d+/.test(r) || r.includes("tag");
                    return (
                      <span
                        key={r}
                        className="chip"
                        style={{ flexShrink: 0, fontSize: 10.5, padding: "1px 6px", gap: 3, color: "var(--accent-text)", background: "var(--accent-soft)" }}
                        title={r}
                      >
                        {isTag ? <Tag size={10} /> : <GitBranch size={10} />}
                        {r}
                      </span>
                    );
                  })}
                  <span
                    style={{ minWidth: 0, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 12.5, color: "var(--text)" }}
                    title={row.commit.subject}
                  >
                    {row.commit.subject}
                  </span>
                </div>
                <span style={{ flexShrink: 0, fontSize: 11, color: "var(--text-3)" }}>{row.commit.author_name}</span>
                <span style={{ flexShrink: 0, fontSize: 11, color: "var(--text-3)", width: 64, textAlign: "right" }}>{relTime(row.commit.timestamp)}</span>
                <span className="mono" style={{ flexShrink: 0, fontSize: 10.5, color: "var(--text-3)", width: 56, textAlign: "right" }}>{row.commit.short_sha}</span>
              </div>
            ))
          : null}
      </div>
      {/* GitHub 연결이 없으면 커밋을 웹에서 열 수 없음을 안내 (dogfooding 2026-06-15) */}
      {!ghBase ? (
        <div
          className="panel-body"
          style={{ borderTop: "1px solid var(--border-card)", padding: "8px 14px", fontSize: 11, color: "var(--text-3)", display: "flex", alignItems: "center", gap: 6 }}
        >
          <TriangleAlert size={12} />
          {t("today.git.noRemote")}
        </div>
      ) : null}
    </div>
  );
}
