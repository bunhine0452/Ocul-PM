/**
 * 오늘 — 사람이 3분 안에 믿고 다음을 결정하는 화면 (4.0 `{#ui-today}`).
 *
 * 원칙: **예외만 보여 준다.** 화면의 크기는 에이전트가 한 양이 아니라 사람이 볼 것에
 * 비례한다. 하루 60건 쓰는 사람과 3건 쓰는 사람이 모드 없이 같은 화면을 쓴다 — 증거가
 * 선 일은 한 줄로 접히고, 판정(완료 조건이 참인가)은 에이전트의 말이 아니라 확인 명령의
 * 결과 끝 줄이다.
 *
 *   왼쪽   하루 한 줄 → 확인할 것 → 오늘 한 일
 *   오른쪽 지금 일하는 중 → 계획 → 다음
 *
 * 키보드는 이 화면 안에서만 — j/k 확인할 것 이동 · Enter 기본 동작 · v 확인함 · c 다음
 * 프롬프트 복사. 전역 keydown 은 쓰지 않는다(화면 컨테이너가 받는다).
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { hooksApi } from "@/api/claudeSurface";
import { toAppError } from "@/api/invoke";
import { oculpmApi } from "@/api/oculpm";
import { planApi } from "@/api/plan";
import { ErrorCard } from "@/components/ErrorCard";
import { NotebookText } from "@/components/Icons";
import { Toolbar } from "@/components/Toolbar";
import { type UiV2View, useOptionalWorkspace } from "@/contexts/WorkspaceContext";
import { useMinuteTick } from "@/hooks/useSecondTick";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import type { JournalEntrySummary } from "@/lib/bindings";
import { requestOculpmActivate } from "@/lib/projectActions";
import { consumeResumeOnOpen } from "@/lib/resumeIntent";
import { openSettings } from "@/lib/settingsNav";
import { toast } from "@/lib/toast";
import { TodayExceptions } from "./TodayExceptions";
import { LiveCard, NextCard, PlansCard } from "./TodaySide";
import { TodayWork } from "./TodayWork";
import { Num } from "./todayFormat";
import { dayStats, firstNext, type TodayException } from "./todayModel";
import { useTodayExceptions } from "./useTodayExceptions";
import { liveSessionsOf, useLiveSessions } from "./useLiveSessions";
import "./today.css";

interface TodayScreenV2Props {
  projectId: number;
  /** 셸이 넘긴다 — 이 화면은 쓰지 않는다. */
  projectRoot?: string | null;
  /** YYYYMMDD current workday (from OculpmStatus / workdayKey). */
  workday: string | null;
  /** ocul-pm active? When false we show the activation hint. */
  oculpmReady: boolean;
  onNavigate: (view: UiV2View) => void;
  dateLabel: string;
  /** 셸이 넘긴다 — 이 화면은 쓰지 않는다. */
  tz?: string;
  /** 작업 일지 화면에서 이 일지를 연다 (셸의 포커스 핸드오프). 없으면 화면만 옮긴다. */
  onOpenEntry?: (entry: Pick<JournalEntrySummary, "relative_path">) => void;
}

/** 입력칸 안의 j/k/v 는 글자다 — 가로채지 않는다. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function TodayScreenV2({ projectId, workday, oculpmReady, onNavigate, dateLabel, onOpenEntry }: TodayScreenV2Props) {
  const { t } = useT();
  const ws = useOptionalWorkspace();
  const today = useTodayExceptions(projectId, workday, oculpmReady);
  const { data, exceptions, error, refresh, markVerified } = today;
  const { sessions } = useLiveSessions(projectId, workday, oculpmReady);
  const now = useMinuteTick(oculpmReady);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Array<HTMLLIElement | null>>([]);
  const [active, setActive] = useState(-1);

  // 화면에 들어오면 키보드가 바로 닿게 — 입력칸에 있던 포커스는 빼앗지 않는다.
  useEffect(() => {
    if (!isTyping(document.activeElement)) rootRef.current?.focus({ preventScroll: true });
  }, []);

  // 시작 탭의 「이 맥락으로 이어서 작업」 — 프로젝트가 열려 이 화면이 서면 한 번, 이어하기
  // 프롬프트를 클립보드에 둔다. 보내는 것은 사용자다(자기 터미널의 에이전트에 붙여 넣는다).
  useEffect(() => {
    if (!oculpmReady || !consumeResumeOnOpen(projectId)) return;
    void hooksApi
      .resumeDispatchPrompt(projectId)
      .then((res) => navigator.clipboard.writeText(res.prompt))
      .then(() => toast.info(t("today.resume.dispatchCopied")))
      .catch((e: unknown) => toast.destructive(t("today.resume.dispatchFailed", { error: tError(toAppError(e)) })));
    // 뜻은 한 번만 소비된다 — t 가 바뀌어도 다시 돌 일이 없다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oculpmReady, projectId]);

  const openPlan = useCallback(
    (planId: string) => {
      ws?.setState((prev) => (prev.plannerPlanId === planId ? prev : { ...prev, plannerPlanId: planId }));
      onNavigate("planner");
    },
    [ws, onNavigate],
  );

  const openEntry = useCallback(
    (entry: Pick<JournalEntrySummary, "relative_path">) => {
      if (onOpenEntry) onOpenEntry({ relative_path: entry.relative_path });
      else onNavigate("journal");
    },
    [onOpenEntry, onNavigate],
  );

  const verify = useCallback(
    async (entry: JournalEntrySummary) => {
      markVerified(entry.relative_path, true);
      try {
        await oculpmApi.setJournalVerified(projectId, entry.relative_path, true);
        toast.info(t("today.check.verified"));
        refresh();
      } catch (e) {
        markVerified(entry.relative_path, false);
        toast.destructive(t("today.check.verifyFailed", { error: tError(toAppError(e)) }));
      }
    },
    [projectId, markVerified, refresh, t],
  );

  const next = firstNext(data.digest ?? null);
  const copyNext = useCallback(async () => {
    if (!next) return;
    try {
      const res = await planApi.dispatchPrompt(projectId, next.plan.plan_id, next.item.item_id);
      await navigator.clipboard.writeText(res.prompt);
      toast.info(t("plan.dispatchCopied", { title: res.item_title }));
    } catch (e) {
      toast.destructive(t("plan.dispatchFailed", { error: tError(toAppError(e)) }));
    }
  }, [next, projectId, t]);

  const copyPluginUpdate = useCallback(() => {
    void navigator.clipboard
      ?.writeText("/plugin update oculpm@oculpm")
      .then(() => toast.info(t("today.pluginDrift.copied")));
  }, [t]);

  const runPrimary = useCallback(
    (ex: TodayException) => {
      switch (ex.kind) {
        case "verdict":
          return openPlan(ex.plan.plan_id);
        case "evidence":
          return openEntry(ex.entry);
        case "unrecorded":
        case "silent":
          return onNavigate("diff");
        case "blocked":
        case "decision":
          return openPlan(ex.planId);
        case "plugin":
          return copyPluginUpdate();
      }
    },
    [openPlan, openEntry, onNavigate, copyPluginUpdate],
  );

  const focusRow = (i: number) => {
    setActive(i);
    rowRefs.current[i]?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
    const rows = exceptions ?? [];
    const cur = Math.min(active, rows.length - 1);
    if (e.key === "j" || e.key === "k") {
      if (rows.length === 0) return;
      e.preventDefault();
      focusRow(e.key === "j" ? Math.min(cur + 1, rows.length - 1) : Math.max(cur - 1, 0));
    } else if (e.key === "Enter") {
      // 행 안의 버튼에서 누른 Enter 는 그 버튼의 것이다.
      if (cur < 0 || e.target !== rowRefs.current[cur]) return;
      e.preventDefault();
      runPrimary(rows[cur]);
    } else if (e.key === "v") {
      const ex = cur >= 0 ? rows[cur] : undefined;
      if (ex?.kind !== "evidence") return;
      e.preventDefault();
      void verify(ex.entry);
    } else if (e.key === "c") {
      if (!next) return;
      e.preventDefault();
      void copyNext();
    }
  };

  const entries = data.entries ?? [];
  const stats = dayStats(entries);
  const live = sessions ? liveSessionsOf(sessions, entries) : [];
  const firstRun = data.totalEntries === 0;

  let body: ReactNode;
  if (!oculpmReady) {
    body = (
      <div className="card tdy-card tdy-pad tdy-notice">
        <span>{t("today.notActive")}</span>
        <button type="button" className="btn primary sm" onClick={requestOculpmActivate}>
          {t("today.activateNow")}
        </button>
      </div>
    );
  } else if (error) {
    body = <ErrorCard title={t("today.loadFailed")} error={error} onRetry={refresh} />;
  } else {
    body = (
      <div className="tdy-body">
        <div className="tdy-col">
          {firstRun ? (
            <section className="card tdy-card tdy-first" aria-labelledby="tdy-first-h">
              <NotebookText size={18} className="tdy-first-ico" aria-hidden="true" />
              <div className="tdy-grow">
                <h2 id="tdy-first-h" className="tdy-strong">
                  {t("today.first.title")}
                </h2>
                <p className="tdy-meta">{t("today.first.body")}</p>
                <button
                  type="button"
                  className="btn primary sm"
                  onClick={() => {
                    onNavigate("settings");
                    openSettings("agents");
                  }}
                >
                  {t("today.first.connect")}
                </button>
              </div>
            </section>
          ) : (
            <>
              {data.entries ? (
                <div className="tdy-day">
                  <Num k="today.day.records" n={stats.total} />
                  <span title={t("today.day.evidenceTitle")}>
                    <Num k="today.day.evidence" n={stats.withEvidence} />
                    {stats.pct != null ? ` · ${stats.pct}%` : null}
                  </span>
                  {sessions && sessions.length > 1 ? <Num k="today.day.sessions" n={sessions.length} /> : null}
                  {exceptions ? (
                    <Num k="today.day.check" n={exceptions.length} className={exceptions.length > 0 ? "tdy-warn" : undefined} />
                  ) : null}
                </div>
              ) : null}
              <TodayExceptions
                exceptions={exceptions}
                entryCount={entries.length}
                unrecordedKnown={data.unrecorded != null}
                activeIndex={active}
                setActiveIndex={setActive}
                rowRefs={rowRefs}
                onPrimary={runPrimary}
                onVerify={(entry) => void verify(entry)}
              />
              {/* 오늘 기록이 없으면 이 카드는 위 문단을 되풀이할 뿐이다. */}
              {entries.length > 0 && data.digest ? (
                <TodayWork entries={entries} digest={data.digest} onOpenEntry={openEntry} />
              ) : null}
            </>
          )}
        </div>
        <div className="tdy-col tdy-side">
          <LiveCard sessions={live} now={now} />
          {data.digest ? <PlansCard digest={data.digest} onOpenPlan={openPlan} /> : null}
          {data.digest && data.digest.plans.length > 0 ? (
            <NextCard next={next} onCopy={() => void copyNext()} onOther={() => onNavigate("planner")} />
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <>
      <Toolbar title={t("nav.today")} sub={dateLabel} find>
        {oculpmReady && !firstRun ? <span className="tdy-keys">{t("today.kbd.hint")}</span> : null}
      </Toolbar>
      <div className="scroll">
        <div ref={rootRef} className="page tdy" tabIndex={-1} onKeyDown={onKeyDown}>
          {body}
        </div>
      </div>
    </>
  );
}
