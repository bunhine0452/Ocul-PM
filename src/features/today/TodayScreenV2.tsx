import { useState } from "react";
import { Toolbar } from "@/components/Toolbar";
import {
  SearchIcon,
  NotebookText,
  GitCompareArrows,
  GitCommitVertical,
  FileCode2,
  TriangleAlert,
  Bot,
  Star,
  History,
  ArrowRight,
  Terminal,
  Clipboard,
} from "@/components/Icons";
import { type UiV2View } from "@/contexts/WorkspaceContext";
import { commands, type JournalEntrySummary } from "@/lib/bindings";
import { toast } from "@/lib/toast";
import { resolveLlmTarget } from "@/lib/llmTarget";
import { Skeleton } from "@/components/ui/Skeleton";
import { StatCard } from "./StatCard";
import { MiniEntry } from "./MiniEntry";
import { WeekChart } from "./WeekChart";
import { AgentBreakdown } from "./AgentBreakdown";
import { NextTasks } from "./NextTasks";
import { TodayActivityRing } from "./TodayActivityRing";
import { TodayTerminal } from "./TodayTerminal";
import { HonestyAudit } from "./HonestyAudit";
import { JournalMissingCard } from "./JournalMissingCard";
import { PlanUpdates } from "./PlanUpdates";
import { DiscussionPending } from "./DiscussionPending";
import { TodayMonitor } from "./TodayMonitor";
import { TodayGitGraph } from "./TodayGitGraph";
import { useTodayBrief } from "./useTodayBrief";
import { useTodayMonitor } from "./useTodayMonitor";
import { useT } from "@/i18n";

// Final UI Update (ui_v2) — Today 6-block dashboard (02-screen-specs §1).
// Pure presenter over useTodayBrief (frontend aggregation, no new backend
// command — PR-UI 2 §0.8). Empty / loading / error states per 01-ia-and-shell
// §7.

interface TodayScreenV2Props {
  projectId: number;
  /** Project root — cwd for the embedded 빠른 터미널. */
  projectRoot: string | null;
  /** YYYYMMDD current workday (from OculpmStatus / workdayKey). */
  workday: string | null;
  /** ocul-pm active? When false we show the activation hint. */
  oculpmReady: boolean;
  onNavigate: (view: UiV2View) => void;
  dateLabel: string;
  tz: string;
  /**
   * Open the 작업 일지 화면 with this entry ring-highlighted. Provided by
   * ShellV2 (PR-UI 3 focus handoff). When omitted, falls back to a plain nav.
   */
  onOpenEntry?: (entry: JournalEntrySummary) => void;
}

export function TodayScreenV2({
  projectId,
  projectRoot,
  workday,
  oculpmReady,
  onNavigate,
  dateLabel,
  tz,
  onOpenEntry,
}: TodayScreenV2Props) {
  const { t } = useT();
  const { brief, loading, error, refresh } = useTodayBrief(
    projectId,
    workday,
    oculpmReady,
  );
  // v2 U12 — "다음 할 일"과 총 일지 수는 brief 한 콜에 동승 (useNextTasks 의
  // planList+planGet×N, 모니터의 365일 히트맵 IPC 제거).
  const nextTasks = brief?.nextTasks ?? null;
  const { monitor } = useTodayMonitor(
    projectId,
    workday,
    oculpmReady,
    brief?.totalEntries ?? null,
  );
  const [termOpen, setTermOpen] = useState(false);

  // Clicking a highlight / yesterday row jumps to the Journal screen with the
  // entry ring-highlighted (ShellV2 owns the one-shot focus path). Without the
  // handoff prop (e.g. in unit tests) we just navigate.
  const openEntry = (entry: JournalEntrySummary) => {
    if (onOpenEntry) onOpenEntry(entry);
    else onNavigate("journal");
  };

  const empty = oculpmReady && !loading && brief != null && brief.changedToday === 0;

  // v2 U10 (C1) — 원클릭 스탠드업: 어제~오늘 일지 + 활성 플랜을 마크다운으로
  // 만들어 클립보드에. LLM 미설정이어도 결정적 폴백으로 항상 동작한다.
  const [standupBusy, setStandupBusy] = useState(false);
  const copyStandup = async () => {
    if (standupBusy || !workday) return;
    setStandupBusy(true);
    try {
      const y = new Date(
        Number(workday.slice(0, 4)),
        Number(workday.slice(4, 6)) - 1,
        Number(workday.slice(6, 8)) - 1,
      );
      const since = `${y.getFullYear()}${String(y.getMonth() + 1).padStart(2, "0")}${String(
        y.getDate(),
      ).padStart(2, "0")}`;
      const target = await resolveLlmTarget();
      const res = await commands.oculpmGenerateSummary(
        projectId,
        since,
        workday,
        "standup",
        target?.provider ?? null,
        target?.model ?? null,
      );
      if (res.status !== "ok") {
        toast.destructive(t("today.standup.failed", { error: res.error }));
        return;
      }
      await navigator.clipboard.writeText(res.data.markdown);
      toast.info(
        res.data.used_llm
          ? t("today.standup.copiedAi")
          : t("today.standup.copiedPlain"),
      );
    } finally {
      setStandupBusy(false);
    }
  };

  return (
    <>
      <Toolbar title={t("nav.today")} sub={dateLabel}>
        <button
          type="button"
          className="search-box"
          style={{ minWidth: 200 }}
          onClick={() => onNavigate("search")}
          aria-label={t("today.search.open")}
        >
          <SearchIcon size={15} color="var(--text-3)" />
          <span style={{ color: "var(--text-3)", flex: 1, textAlign: "left" }}>{t("today.search.placeholder")}</span>
          <span className="kbd">⌘K</span>
        </button>
        <button
          className="btn"
          onClick={() => void copyStandup()}
          disabled={standupBusy || !oculpmReady || !workday}
          title={t("today.standup.title")}
        >
          <Clipboard size={15} /> {standupBusy ? t("today.standup.busy") : t("today.standup.copy")}
        </button>
        <button className="btn" onClick={() => onNavigate("journal")}>
          <NotebookText size={15} /> {t("today.allEntries")}
        </button>
      </Toolbar>

      <div className="scroll">
        <div className="page fade-in">
          {/* Hero */}
          <div className="today-hero">
            <div style={{ display: "flex", alignItems: "center", gap: 18, minWidth: 0 }}>
              {oculpmReady && brief ? (
                <TodayActivityRing
                  changedToday={brief.changedToday}
                  filesTouched={brief.filesTouched}
                  linesAdded={brief.linesAdded}
                  linesRemoved={brief.linesRemoved}
                  errorCycles={brief.errorCycles}
                />
              ) : null}
              <div style={{ minWidth: 0 }}>
                <div className="today-greet">
                  {oculpmReady && brief ? (
                    <>
                      {t("today.headlinePrefix")}{" "}
                      <span className="accent">{t("today.headlineCount", { n: brief.changedToday })}</span>{" "}
                      {t("today.headlineSuffix")}
                    </>
                  ) : oculpmReady ? (
                    <Skeleton width={240} height={22} style={{ display: "inline-block", verticalAlign: "middle" }} />
                  ) : (
                    t("today.notActive")
                  )}
                </div>
                <div className="today-date">
                  {t("today.subhead")} · {tz}
                </div>
              </div>
            </div>
            <button className="btn primary" onClick={() => onNavigate("diff")}>
              <GitCompareArrows size={15} /> {t("today.reviewChanges")}
            </button>
          </div>

          {error ? (
            <div className="card card-pad" style={{ marginBottom: 16 }}>
              <div className="stat-top" style={{ color: "var(--t-bug)" }}>
                <TriangleAlert size={14} /> {t("today.loadFailed")}
              </div>
              <div className="today-date" style={{ marginTop: 8 }}>{error}</div>
              <button className="btn sm" style={{ marginTop: 12 }} onClick={refresh}>
                {t("common.retry")}
              </button>
            </div>
          ) : null}

          {/* Stat row */}
          <div className="stat-row">
            <StatCard
              icon={GitCommitVertical}
              tint={{ bg: "var(--accent-soft)", fg: "var(--accent-text)" }}
              label={t("today.stat.recorded")}
              value={brief ? brief.changedToday : "—"}
              unit={t("today.unit.entries")}
            />
            <StatCard
              icon={FileCode2}
              tint={{ bg: "var(--t-chore-soft)", fg: "var(--t-chore)" }}
              label={t("today.stat.filesChanged")}
              value={brief ? brief.filesTouched : "—"}
              unit={t("today.unit.files")}
              sub={
                brief ? (
                  <span className="mono">
                    <span className="diff-add">+{brief.linesAdded}</span>{" "}
                    <span className="diff-del">−{brief.linesRemoved}</span> {t("today.unit.lines")}
                  </span>
                ) : null
              }
            />
            <StatCard
              icon={TriangleAlert}
              tint={{ bg: "var(--t-error-soft)", fg: "var(--t-error)" }}
              label={t("today.stat.errorCycles")}
              value={brief ? brief.errorCycles : "—"}
              unit={t("today.unit.times")}
            />
            <StatCard
              icon={Bot}
              tint={{ bg: "var(--t-refactor-soft)", fg: "var(--t-refactor)" }}
              label={t("today.stat.agents")}
              value={brief ? brief.agents.length : "—"}
              unit={t("today.unit.files")}
            />
          </div>

          {/* 모니터링 행 — 활동시간 · 전체 작업 일지 · 오늘 커밋 · 미커밋 변경 */}
          {oculpmReady ? <TodayMonitor monitor={monitor} /> : null}

          {/* 빠른 터미널 — Today 에서 바로 에이전트 실행 (opt-in) */}
          <TodayTerminal
            projectRoot={projectRoot}
            open={termOpen}
            onOpenChange={setTermOpen}
            onFull={() => onNavigate("terminal")}
          />

          {empty ? (
            <div className="card card-pad">
              <div
                className="empty-hint"
                style={{ padding: "40px 20px 16px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 }}
              >
                <div>
                  {t("today.empty")}
                </div>
                <button className="btn primary" onClick={() => setTermOpen(true)}>
                  <Terminal size={15} /> {t("today.runAgent")}
                </button>
              </div>
            </div>
          ) : (
            <div className="grid-2 grid-2-fill">
              {/* LEFT: 오늘 하이라이트 → 오늘의 에이전트 → 어제 마무리
                  (에이전트는 오른쪽 열에 있었다 — 오른쪽만 길어져 왼쪽 아래로
                  빈 배경이 드러나던 걸 같은 "오늘" 묶음으로 옮겨 균형을 맞춘다) */}
              <div className="g2col">
                <div className="card">
                  <div className="panel-head">
                    <Star size={16} color="var(--accent-text)" />
                    <h3>{t("today.highlights")}</h3>
                    <span className="count">{brief ? brief.highlights.length : 0}</span>
                    <button
                      className="btn ghost sm right"
                      onClick={() => onNavigate("journal")}
                      aria-label={t("today.viewAllAria")}
                    >
                      {t("today.viewAll")} <ArrowRight size={13} />
                    </button>
                  </div>
                  <div className="panel-body">
                    {brief && brief.highlights.length > 0 ? (
                      brief.highlights.map((e) => (
                        <MiniEntry key={e.relative_path} entry={e} onOpen={openEntry} />
                      ))
                    ) : (
                      <div className="empty-hint">{t("today.noHighlights")}</div>
                    )}
                  </div>
                </div>

                {brief ? <AgentBreakdown agents={brief.agents} /> : null}

                <div className="card">
                  <div className="panel-head">
                    <History size={16} color="var(--text-2)" />
                    <h3>{t("today.yesterday")}</h3>
                    <span className="count">{brief ? brief.yesterdayDone.length : 0}</span>
                  </div>
                  <div className="panel-body">
                    {brief && brief.yesterdayDone.length > 0 ? (
                      brief.yesterdayDone.map((e) => (
                        <MiniEntry key={e.relative_path} entry={e} onOpen={openEntry} />
                      ))
                    ) : (
                      <div className="empty-hint">{t("today.noYesterday")}</div>
                    )}
                  </div>
                </div>
              </div>

              {/* RIGHT: 흐름(주간)과 앞으로(다음 할 일) */}
              <div className="g2col">
                {brief ? <WeekChart week={brief.week} /> : null}
                <NextTasks tasks={nextTasks} onOpenPlanner={() => onNavigate("planner")} />
              </div>
            </div>
          )}

          <DiscussionPending projectId={projectId} onNavigate={onNavigate} />

          <PlanUpdates projectId={projectId} onNavigate={onNavigate} />

          {/* F2 정직성 감사 — 기록 누락 변경이 있을 때만 렌더 */}
          <HonestyAudit projectId={projectId} workday={workday} enabled={oculpmReady} />

          {/* H3b 일지 없이 끝난 세션 — 플러그인 훅 신호가 있을 때만 렌더 */}
          <JournalMissingCard
            projectId={projectId}
            enabled={oculpmReady}
            onNavigate={onNavigate}
          />

          {/* 커밋 그래프 — 맨 아래 (dogfooding 2026-06-15) */}
          {oculpmReady ? <TodayGitGraph projectId={projectId} enabled={oculpmReady} /> : null}
        </div>
      </div>
    </>
  );
}
