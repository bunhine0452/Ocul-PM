import { Clock, GitBranch, Target } from "@/components/Icons";
import { StatCard } from "./StatCard";
import type { TodayMonitor as TodayMonitorData } from "./useTodayMonitor";

// Code-search round (2026-06-15) — a second Today stat row: active work time,
// git status / today's commits, and goal progress. Mirrors the StatCard layout
// of the primary row so it reads as one dashboard.

function fmtDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return `${h}시간 ${m}분`;
  return `${m}분`;
}

export function TodayMonitor({ monitor }: { monitor: TodayMonitorData | null }) {
  return (
    <div className="stat-row" style={{ marginTop: 12 }}>
      {/* 활동 시간 — Σ session active windows */}
      <StatCard
        icon={Clock}
        tint={{ bg: "var(--t-refactor-soft)", fg: "var(--t-refactor)" }}
        label="활동 시간"
        value={monitor ? fmtDuration(monitor.activeMs) : "—"}
        sub={
          monitor ? (
            <span>
              {monitor.sessionCount}개 세션
            </span>
          ) : null
        }
      />

      {/* Git — today's commits + branch + dirty count */}
      <StatCard
        icon={GitBranch}
        tint={{ bg: "var(--accent-soft)", fg: "var(--accent-text)" }}
        label="오늘 커밋"
        value={monitor && monitor.isGitRepo ? monitor.commitsToday : "—"}
        unit={monitor && monitor.isGitRepo ? "개" : undefined}
        sub={
          monitor && monitor.isGitRepo ? (
            <span style={{ display: "block", minWidth: 0 }}>
              <span className="mono">{monitor.branch ?? "detached"}</span>
              {monitor.uncommitted > 0 ? (
                <span className="diff-del"> · 미커밋 {monitor.uncommitted}</span>
              ) : null}
              {monitor.latestCommit ? (
                <span
                  style={{
                    display: "block",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: "var(--text-3)",
                  }}
                  title={monitor.latestCommit.subject}
                >
                  {monitor.latestCommit.subject}
                </span>
              ) : null}
            </span>
          ) : (
            <span>git 저장소 아님</span>
          )
        }
      />

      {/* 목표 — avg progress + open/due/overdue */}
      <StatCard
        icon={Target}
        tint={{ bg: "var(--t-chore-soft)", fg: "var(--t-chore)" }}
        label="목표 진행률"
        value={monitor && monitor.goalTotal > 0 ? monitor.goalPct : "—"}
        unit={monitor && monitor.goalTotal > 0 ? "%" : undefined}
        sub={
          monitor && monitor.goalTotal > 0 ? (
            <span>
              진행 {monitor.goalInProgress} · 미완 {monitor.goalOpen}
              {monitor.goalDueToday > 0 ? (
                <span className="accent"> · 오늘 마감 {monitor.goalDueToday}</span>
              ) : null}
              {monitor.goalOverdue > 0 ? (
                <span className="diff-del"> · 지연 {monitor.goalOverdue}</span>
              ) : null}
            </span>
          ) : (
            <span>등록된 목표 없음</span>
          )
        }
      />
    </div>
  );
}
