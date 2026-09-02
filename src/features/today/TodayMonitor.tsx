import { useSecondTick } from "@/hooks/useSecondTick";
import { Clock, FileDiff, GitBranch, NotebookText } from "@/components/Icons";
import { StatCard } from "./StatCard";
import type { TodayMonitor as TodayMonitorData } from "./useTodayMonitor";
import { t } from "@/i18n";

// Code-search round (2026-06-15) — a second Today stat row: active work time,
// git status / today's commits, and goal progress. Mirrors the StatCard layout
// of the primary row so it reads as one dashboard.
//
// Dogfooding 2026-06-15: this row only had 2 cards, leaving 2 empty columns in
// the shared 4-column `.stat-row`. Filled to a full 4 — left pair = work
// progress (활동 시간 · 전체 작업 일지), right pair = git (오늘 커밋 · 미커밋 변경).
// 전체 작업 일지 = this project's lifetime journal-entry count (monitor.totalEntries).

function fmtDuration(ms: number): string {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return t("time.hoursMinutes", { h, m });
  return t("time.minutes", { n: m });
}

export function TodayMonitor({ monitor }: { monitor: TodayMonitorData | null }) {
  // The backend stamps a session's active_window_ms only on end, so the open
  // session contributes its elapsed time via `openSince`. Tick it here — kept in
  // this small component so only the stat row re-renders, not the whole screen.
  const openSince = monitor?.openSince ?? null;
  const now = useSecondTick(openSince != null);
  const activeMs = monitor
    ? monitor.activeMs + (openSince != null ? Math.max(0, now - openSince) : 0)
    : 0;

  return (
    <div className="stat-row" style={{ marginTop: 12 }}>
      {/* 활동 시간 — Σ session active windows */}
      <StatCard
        icon={Clock}
        label={t("today.monitor.activeTime")}
        value={monitor ? fmtDuration(activeMs) : "—"}
        sub={
          monitor ? (
            <span>
              {t("today.monitor.sessions", { n: monitor.sessionCount })}
            </span>
          ) : null
        }
      />

      {/* 전체 작업 일지 — this project's lifetime journal-entry count */}
      <StatCard
        icon={NotebookText}
        label={t("today.monitor.totalEntries")}
        value={monitor ? monitor.totalEntries : "—"}
        unit={monitor ? t("today.unit.entries") : undefined}
        sub={monitor ? <span>{t("today.monitor.cumulative")}</span> : null}
      />

      {/* Git — today's commits + branch + dirty count */}
      <StatCard
        icon={GitBranch}
        label={t("today.monitor.commitsToday")}
        value={monitor && monitor.isGitRepo ? monitor.commitsToday : "—"}
        unit={monitor && monitor.isGitRepo ? t("today.unit.count") : undefined}
        sub={
          monitor && monitor.isGitRepo ? (
            <span style={{ display: "block", minWidth: 0 }}>
              <span className="mono">{monitor.branch ?? "detached"}</span>
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
            <span>{t("today.monitor.notGitRepo")}</span>
          )
        }
        hoverTip={
          monitor && monitor.isGitRepo && monitor.latestCommit ? (
            <>
              <div style={{ fontWeight: 600, color: "var(--text)" }}>
                {monitor.latestCommit.subject}
              </div>
              <div className="mono" style={{ marginTop: 4, color: "var(--text-3)" }}>
                {monitor.latestCommit.short_sha} · {monitor.latestCommit.author_name}
              </div>
            </>
          ) : undefined
        }
      />

      {/* 미커밋 변경 — pending working-tree changes awaiting a commit */}
      <StatCard
        icon={FileDiff}
        label={t("today.monitor.uncommitted")}
        value={monitor && monitor.isGitRepo ? monitor.uncommitted : "—"}
        unit={monitor && monitor.isGitRepo ? t("today.unit.count") : undefined}
        sub={
          monitor && monitor.isGitRepo ? (
            monitor.uncommitted > 0 ? (
              <span className="diff-del">{t("today.monitor.pending")}</span>
            ) : (
              <span>{t("today.monitor.allCommitted")}</span>
            )
          ) : (
            <span>{t("today.monitor.notGitRepo")}</span>
          )
        }
      />
    </div>
  );
}
