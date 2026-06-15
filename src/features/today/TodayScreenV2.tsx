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
} from "@/components/Icons";
import { type UiV2View } from "@/contexts/WorkspaceContext";
import type { JournalEntrySummary } from "@/lib/bindings";
import { StatCard } from "./StatCard";
import { MiniEntry } from "./MiniEntry";
import { WeekChart } from "./WeekChart";
import { AgentBreakdown } from "./AgentBreakdown";
import { NextTasks } from "./NextTasks";
import { TodayActivityRing } from "./TodayActivityRing";
import { TodayTerminal } from "./TodayTerminal";
import { PlanUpdates } from "./PlanUpdates";
import { TodayMonitor } from "./TodayMonitor";
import { TodayGitGraph } from "./TodayGitGraph";
import { useTodayBrief } from "./useTodayBrief";
import { useTodayMonitor } from "./useTodayMonitor";
import { useNextTasks } from "./useNextTasks";

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
  const { brief, loading, error, refresh } = useTodayBrief(
    projectId,
    workday,
    oculpmReady,
  );
  const { tasks: nextTasks } = useNextTasks(projectId);
  const { monitor } = useTodayMonitor(projectId, workday, oculpmReady);
  const [termOpen, setTermOpen] = useState(false);

  // Clicking a highlight / yesterday row jumps to the Journal screen with the
  // entry ring-highlighted (ShellV2 owns the one-shot focus path). Without the
  // handoff prop (e.g. in unit tests) we just navigate.
  const openEntry = (entry: JournalEntrySummary) => {
    if (onOpenEntry) onOpenEntry(entry);
    else onNavigate("journal");
  };

  const empty = oculpmReady && !loading && brief != null && brief.changedToday === 0;

  return (
    <>
      <Toolbar title="Today" sub={dateLabel}>
        <button
          type="button"
          className="search-box"
          style={{ minWidth: 200 }}
          onClick={() => onNavigate("search")}
          aria-label="코드 검색 열기"
        >
          <SearchIcon size={15} color="var(--text-3)" />
          <span style={{ color: "var(--text-3)", flex: 1, textAlign: "left" }}>코드 검색…</span>
          <span className="kbd">⌘K</span>
        </button>
        <button className="btn" onClick={() => onNavigate("journal")}>
          <NotebookText size={15} /> 전체 일지
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
                  bytesAdded={brief.bytesAdded}
                  bytesRemoved={brief.bytesRemoved}
                  errorCycles={brief.errorCycles}
                />
              ) : null}
              <div style={{ minWidth: 0 }}>
                <div className="today-greet">
                  {oculpmReady && brief ? (
                    <>
                      오늘 <span className="accent">{brief.changedToday}건</span>의 작업이
                      기록됐어요
                    </>
                  ) : oculpmReady ? (
                    "오늘의 기록을 불러오는 중…"
                  ) : (
                    "ocul-pm이 아직 활성화되지 않았어요"
                  )}
                </div>
                <div className="today-date">
                  AI 에이전트가 코드를 쓰는 동안 Ocul-PM이 자동으로 일지를 작성합니다 · {tz}
                </div>
              </div>
            </div>
            <button className="btn primary" onClick={() => onNavigate("diff")}>
              <GitCompareArrows size={15} /> 오늘 변경 검토
            </button>
          </div>

          {error ? (
            <div className="card card-pad" style={{ marginBottom: 16 }}>
              <div className="stat-top" style={{ color: "var(--t-bug)" }}>
                <TriangleAlert size={14} /> 오늘 데이터를 불러오지 못했어요
              </div>
              <div className="today-date" style={{ marginTop: 8 }}>{error}</div>
              <button className="btn sm" style={{ marginTop: 12 }} onClick={refresh}>
                다시 시도
              </button>
            </div>
          ) : null}

          {/* Stat row */}
          <div className="stat-row">
            <StatCard
              icon={GitCommitVertical}
              tint={{ bg: "var(--accent-soft)", fg: "var(--accent-text)" }}
              label="기록된 작업"
              value={brief ? brief.changedToday : "—"}
              unit="건"
            />
            <StatCard
              icon={FileCode2}
              tint={{ bg: "var(--t-chore-soft)", fg: "var(--t-chore)" }}
              label="변경된 파일"
              value={brief ? brief.filesTouched : "—"}
              unit="개"
              sub={
                brief ? (
                  <span className="mono">
                    <span className="diff-add">+{brief.bytesAdded}</span>{" "}
                    <span className="diff-del">−{brief.bytesRemoved}</span> 바이트
                  </span>
                ) : null
              }
            />
            <StatCard
              icon={TriangleAlert}
              tint={{ bg: "var(--t-error-soft)", fg: "var(--t-error)" }}
              label="에러 사이클"
              value={brief ? brief.errorCycles : "—"}
              unit="회"
            />
            <StatCard
              icon={Bot}
              tint={{ bg: "var(--t-refactor-soft)", fg: "var(--t-refactor)" }}
              label="참여 에이전트"
              value={brief ? brief.agents.length : "—"}
              unit="개"
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
                  오늘 아직 기록이 없어요. 평소처럼 코딩 에이전트로 작업하면 Ocul-PM이 자동으로 일지를 작성합니다.
                </div>
                <button className="btn primary" onClick={() => setTermOpen(true)}>
                  <Terminal size={15} /> 여기서 에이전트 실행
                </button>
              </div>
            </div>
          ) : (
            <div className="grid-2">
              {/* LEFT: highlights + yesterday */}
              <div>
                <div className="card" style={{ marginBottom: 16 }}>
                  <div className="panel-head">
                    <Star size={16} color="var(--accent-text)" />
                    <h3>오늘의 하이라이트</h3>
                    <span className="count">{brief ? brief.highlights.length : 0}</span>
                    <button
                      className="btn ghost sm right"
                      onClick={() => onNavigate("journal")}
                      aria-label="작업 일지 모두 보기"
                    >
                      모두 보기 <ArrowRight size={13} />
                    </button>
                  </div>
                  <div className="panel-body">
                    {brief && brief.highlights.length > 0 ? (
                      brief.highlights.map((e) => (
                        <MiniEntry key={e.relative_path} entry={e} onOpen={openEntry} />
                      ))
                    ) : (
                      <div className="empty-hint">표시할 하이라이트가 없어요.</div>
                    )}
                  </div>
                </div>

                <div className="card">
                  <div className="panel-head">
                    <History size={16} color="var(--text-2)" />
                    <h3>어제 마무리한 작업</h3>
                    <span className="count">{brief ? brief.yesterdayDone.length : 0}</span>
                  </div>
                  <div className="panel-body">
                    {brief && brief.yesterdayDone.length > 0 ? (
                      brief.yesterdayDone.map((e) => (
                        <MiniEntry key={e.relative_path} entry={e} onOpen={openEntry} />
                      ))
                    ) : (
                      <div className="empty-hint">어제 완료한 작업이 없어요.</div>
                    )}
                  </div>
                </div>
              </div>

              {/* RIGHT: week + agents + next */}
              <div>
                {brief ? <WeekChart week={brief.week} /> : null}
                {brief ? <AgentBreakdown agents={brief.agents} /> : null}
                <NextTasks tasks={nextTasks} onOpenPlanner={() => onNavigate("planner")} />
              </div>
            </div>
          )}

          <PlanUpdates projectId={projectId} onNavigate={onNavigate} />

          {/* 커밋 그래프 — 맨 아래 (dogfooding 2026-06-15) */}
          {oculpmReady ? <TodayGitGraph projectId={projectId} enabled={oculpmReady} /> : null}
        </div>
      </div>
    </>
  );
}
