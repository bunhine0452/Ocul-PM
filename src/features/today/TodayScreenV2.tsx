/**
 * 오늘 — 사람이 3분 안에 믿고 다음을 결정하는 화면 (4.0 `{#ui-today}` · 11-15 한 기둥).
 *
 * 원칙: **예외만 보여 준다.** 화면의 크기는 에이전트가 한 양이 아니라 사람이 볼 것에
 * 비례한다. 하루 60건 쓰는 사람과 3건 쓰는 사람이 모드 없이 같은 화면을 쓴다 — 검증이
 * 선 일은 한 줄로 접히고, 확인 명령의 결과(완료 조건이 참인가)는 에이전트의 말이 아니라
 * 그 명령이 찍은 끝 줄이다.
 *
 *   날짜 줄    날짜 · 오른쪽에 수 한 줄(내 차례 · 닫을 계획 · 받아 온 일지 · 이 기기에만)
 *   왼쪽 칸    (첫 기록 전이면 세 걸음) → 먼저 볼 것(마지막 행이 「다음」) → 검증 없이 끝난 일지 → 지금 일하는 중
 *   오른쪽 칸  오늘 한 일
 *   맨 끝      단축키 한 줄
 *
 * 틀은 처음부터 하나다 — 값이 도착해도, 오른쪽 칸이 비어도 폭이 바뀌지 않는다. 값은 프로젝트별 저장소
 * (`useTodayExceptions`)가 들고 있어 탭에 돌아오면 마지막 값으로 바로 그린다.
 *
 * 키보드는 이 화면 안에서만 — j/k(↑↓) 행 이동 · Home/End · Esc 목록 밖으로, 그리고 포커스가 행에 있을 때만
 * ↩ 기본 동작 · v 읽음 · r 다음을 터미널에서. 전역 keydown 은 쓰지 않는다(화면 컨테이너가 받는다). 한 글자 키는
 * `readChord(e).key` 로 읽는다 — 두벌식 자판에서도 같은 키다(`lib/kbd`).
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { hooksApi } from "@/api/claudeSurface";
import { toAppError } from "@/api/invoke";
import { oculpmApi } from "@/api/oculpm";
import { planApi } from "@/api/plan";
import { ErrorCard } from "@/components/ErrorCard";
import { Toolbar } from "@/components/Toolbar";
import { type UiV2View, useOptionalWorkspace } from "@/contexts/WorkspaceContext";
import { useMinuteTick } from "@/hooks/useSecondTick";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import { CLAUDE_PLUGIN_UPDATE } from "@/lib/agentCommands";
import type { JournalEntrySummary } from "@/lib/bindings";
import { readChord } from "@/lib/kbd";
import { getPlatform } from "@/lib/platform";
import { pluginConnection } from "@/lib/pluginConnection";
import { requestOculpmActivate } from "@/lib/projectActions";
import { openSettings } from "@/lib/settingsNav";
import { toast } from "@/lib/toast";
import { clockOf } from "@/lib/whenLabel";
import { runPromptInTerminal } from "@/features/terminal/runPrompt";
import { requestTermFocus } from "@/features/terminal/focusRequest";
import { requestOnlyMissing } from "@/features/oculpm/onlyMissing";
import { TodayExceptions, TodayUnread, type RowAction, type RowNav } from "./TodayExceptions";
import { FirstSteps } from "./FirstSteps";
import { InitReceipt } from "./InitReceipt";
import { LiveCard, TodayNumbers, liveTerm } from "./TodaySide";
import { TodayWork } from "./TodayWork";
import { UNREAD_LIMIT, firstNext, osLabel, splitExceptions, type TodayException } from "./todayModel";
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

/** 키보드 목록의 한 행 — 예외 행, 그리고 먼저 볼 것 끝의 「다음」. */
type NavRow = TodayException | { kind: "next"; key: "next" };
const NEXT_ROW: NavRow = { kind: "next", key: "next" };

/** 입력칸 안의 j/k/v 는 글자다 — 가로채지 않는다. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * 진행 중인 동작 — 두 번 누르면 두 번 돌지 않게. 같은 틱의 두 번째 클릭도 막도록 상태가 아니라 ref 로 먼저
 * 거르고, 그리기(단추를 잠그고 「여는 중」)는 상태가 깨운다.
 */
function useBusy() {
  const ids = useRef(new Set<string>());
  const [, setTick] = useState(0);
  const run = useCallback(async (id: string, fn: () => Promise<unknown>) => {
    if (ids.current.has(id)) return;
    ids.current.add(id);
    setTick((n) => n + 1);
    try {
      await fn();
    } finally {
      ids.current.delete(id);
      setTick((n) => n + 1);
    }
  }, []);
  const has = useCallback((id: string) => ids.current.has(id), []);
  /** 이 접두로 시작하는 동작이 하나라도 도는 중인가 — 질문 하나에 보낸 답이 여럿일 수 있다. */
  const some = useCallback((prefix: string) => [...ids.current].some((id) => id.startsWith(prefix)), []);
  return useMemo(() => ({ run, has, some }), [run, has, some]);
}

export function TodayScreenV2({ projectId, workday, oculpmReady, onNavigate, dateLabel, onOpenEntry }: TodayScreenV2Props) {
  const { t } = useT();
  const ws = useOptionalWorkspace();
  const today = useTodayExceptions(projectId, workday, oculpmReady);
  const { data, exceptions, error, staleSince, refresh, recheckPlugin, reloadEntries, markVerified } = today;
  const split = useMemo(() => (exceptions ? splitExceptions(exceptions) : null), [exceptions]);
  const { sessions } = useLiveSessions(projectId, workday, oculpmReady);
  const now = useMinuteTick(oculpmReady);
  const busy = useBusy();
  const [sent, setSent] = useState<Record<string, string>>({});

  const rootRef = useRef<HTMLDivElement | null>(null);
  const rowRefs = useRef<Array<HTMLLIElement | null>>([]);
  const [active, setActive] = useState(-1);
  const activeRef = useRef(active);
  activeRef.current = active;
  /**
   * 이 화면 안에서 마지막으로 포커스를 가진 것 — 그것이 화면에서 빠지면(행 · 「모두 읽음」 · 「다시 시도」) 포커스가
   * body 로 떨어져 루트의 키가 죽는다. `land` 는 행 밖 컨트롤이 「빠지면 여기로」 라고 적어 둔 행 자리(`data-land`).
   * 사람이 포커스를 화면 밖으로 옮겼으면 `null` — 그때는 아무것도 되찾지 않는다.
   */
  const lastFocus = useRef<{ el: HTMLElement; land: number | null } | null>(null);

  // 화면에 들어오면 플러그인 상태를 다시 묻는다 — 앱 안 터미널 탭에서 설치 명령을 돌리고 오면 창 포커스는 그대로라
  // 창 복귀가 없다(11-23 #today-plugin-read-once). 처음 마운트면 저장소의 첫 읽기와 같은 틱이라 한 번으로 접힌다.
  useEffect(() => {
    if (oculpmReady) recheckPlugin();
  }, [oculpmReady, recheckPlugin]);

  // 화면에 들어오면 키보드가 바로 닿게 — 입력칸에 있던 포커스는 빼앗지 않는다.
  useEffect(() => {
    if (!isTyping(document.activeElement)) rootRef.current?.focus({ preventScroll: true });
  }, []);

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

  /** 앱 안 터미널의 새 세션에서 `claude "<프롬프트>"` — 못 열면 한 문장으로 말한다. */
  const runInTerminal = useCallback(
    (prompt: string) =>
      runPromptInTerminal(projectId, prompt).catch((e: unknown) =>
        toast.destructive(t("terminal.openFailed", { error: tError(toAppError(e)) })),
      ),
    [projectId, t],
  );

  const verify = useCallback(
    (entry: JournalEntrySummary) =>
      busy.run(`verify:${entry.relative_path}`, async () => {
        markVerified(entry.relative_path, true);
        try {
          await oculpmApi.setJournalVerified(projectId, entry.relative_path, true);
          // 연달아 읽으면 토스트가 쌓인다 — 한 장이면 된다.
          toast.info(t("today.check.verified"), { dedupKey: `today-verified:${projectId}`, dedupWindowMs: 4000 });
          reloadEntries([entry.relative_path]);
        } catch (e) {
          markVerified(entry.relative_path, false);
          toast.destructive(t("today.check.verifyFailed", { error: tError(toAppError(e)) }));
        }
      }),
    [busy, projectId, markVerified, reloadEntries, t],
  );

  // 「되돌리기」 — 방금 모두 읽음으로 표시한 일지를 다시 검증 없음으로. 토스트 단추를 두 번 눌러도 한 번만 쓴다.
  const undoVerified = useCallback(
    (paths: string[]) =>
      void busy.run("undoVerified", async () => {
        for (const p of paths) markVerified(p, false);
        try {
          await oculpmApi.setJournalVerifiedBulk(projectId, paths, false);
          reloadEntries();
        } catch (e) {
          toast.destructive(t("today.unread.undoFailed", { error: tError(toAppError(e)) }));
        }
      }),
    [busy, projectId, markVerified, reloadEntries, t],
  );

  // 「모두 읽음」 — 한 번에 (`oculpm_set_journal_verified_bulk`). 못 한 것(skipped)은 행으로 돌아오고 수로 말한다.
  const verifyAll = useCallback(
    (list: JournalEntrySummary[]) =>
      busy.run("verifyAll", async () => {
        const paths = list.map((e) => e.relative_path);
        for (const p of paths) markVerified(p, true);
        try {
          const report = await oculpmApi.setJournalVerifiedBulk(projectId, paths, true);
          const skipped = new Set((Array.isArray(report?.skipped) ? report.skipped : []).map((s) => s.path));
          for (const p of skipped) markVerified(p, false);
          const done = paths.filter((p) => !skipped.has(p));
          reloadEntries(done);
          const updated = typeof report?.updated === "number" ? report.updated : done.length;
          toast.info(
            skipped.size > 0
              ? t("today.unread.allReadPartial", { n: updated, m: skipped.size })
              : t("today.unread.allReadDone", { n: updated }),
            done.length > 0 ? { actions: [{ label: t("today.unread.undo"), onClick: () => undoVerified(done) }] } : {},
          );
        } catch (e) {
          for (const p of paths) markVerified(p, false);
          toast.destructive(t("today.check.verifyFailed", { error: tError(toAppError(e)) }));
        }
      }),
    [busy, projectId, markVerified, reloadEntries, undoVerified, t],
  );

  // 같은 답을 두 번 누르면 한 번만 간다(열쇠에 답을 담는다). 다른 답은 막지 않는다. 갔는지를 돌려준다 — 답 칸은
  // 간 뒤에만 비운다(못 보냈으면 쓴 글이 남는다).
  const answer = useCallback(
    async (id: string, text: string): Promise<boolean> => {
      let ok = false;
      await busy.run(`answer:${id}:${text}`, async () => {
        try {
          await hooksApi.answerQuestion(projectId, id, text);
          setSent((prev) => ({ ...prev, [id]: clockOf(new Date().toISOString()) }));
          ok = true;
        } catch (e) {
          toast.destructive(t("send.failed", { error: tError(toAppError(e)) }));
        }
      });
      return ok;
    },
    [busy, projectId, t],
  );

  const firstRun = data.totalEntries === 0;
  const next = firstRun ? null : firstNext(data.digest ?? null);
  // 다음 항목을 앱 안 터미널에서 — 새 세션에 `claude "<프롬프트>"` (클립보드 경로는 걷었다).
  const runNext = useCallback(
    () =>
      void busy.run("next", async () => {
        if (!next) return;
        try {
          const res = await planApi.dispatchPrompt(projectId, next.plan.plan_id, next.item.item_id);
          await runPromptInTerminal(projectId, res.prompt);
        } catch (e) {
          toast.destructive(t("plan.dispatchFailed", { error: tError(toAppError(e)) }));
        }
      }),
    [busy, next, projectId, t],
  );

  // 복사가 거절되면(클립보드 권한 · 포커스 없음) 한 문장으로 말한다 — 조용히 삼키면 붙여 넣을 것이 없다. 명령은 설정 ·
  // 첫 실행 안내와 같은 셸 명령 한 모양이다(11-23 #plugin-command-forms — 예전엔 여기만 Claude 안의 `/plugin` 형이었다).
  const copyPluginUpdate = useCallback(
    () =>
      void busy.run("copyPlugin", async () => {
        try {
          if (!navigator.clipboard) throw new Error("clipboard unavailable");
          await navigator.clipboard.writeText(CLAUDE_PLUGIN_UPDATE.join("\n"));
          toast.info(t("today.pluginDrift.copiedShell"));
        } catch {
          toast.destructive(t("op.copyFailed"));
        }
      }),
    [busy, t],
  );

  /** 확인 명령을 이 기기 · 지금 코드에서 다시 돌려 달라는 프롬프트 — 앱이 대신 ✓ 를 적지 않는다. */
  const recheckPrompt = useCallback(
    (ex: Extract<TodayException, { kind: "verdict" | "stale" | "elsewhere" }>) => {
      const base = { plan: ex.plan.plan_id, check: ex.plan.check ?? "" };
      if (ex.kind === "stale") return t("today.check.recheckPrompt", { ...base, files: ex.files.slice(0, 8).join(", ") });
      if (ex.kind === "elsewhere") return t("today.check.recheckHerePrompt", { ...base, os: osLabel(ex.os) });
      return t("today.check.recheckFailPrompt", { ...base, summary: ex.verdict.summary || t("today.check.noSummary") });
    },
    [t],
  );

  /** 행의 동작 — 예외마다 다음 한 걸음. 첫 동작(막히지 않은 것)이 Enter 의 것이다. */
  const actionsFor = (ex: TodayException): RowAction[] => {
    switch (ex.kind) {
      case "question":
      case "evidence":
        return [];
      case "waiting":
        return [
          {
            id: "open",
            label: t("today.check.openTerminal"),
            run: () => {
              requestTermFocus(ex.session.id);
              onNavigate("terminal");
            },
          },
        ];
      case "hookWaiting": {
        const id = `dismiss:${ex.key}`;
        return [
          {
            id,
            label: t("today.check.dismissWaiting"),
            busy: busy.has(id),
            run: () =>
              void busy.run(id, () =>
                hooksApi
                  .dismissWaiting(projectId, ex.item.session_id)
                  .catch((e: unknown) => toast.destructive(t("today.check.dismissFailed", { error: tError(toAppError(e)) }))),
              ),
          },
        ];
      }
      case "verdict":
      case "stale":
      case "elsewhere": {
        const id = `recheck:${ex.key}`;
        return [
          {
            id,
            label: t("today.check.recheck"),
            // 확인 명령이 없는 계획에 「다시 확인」 은 빈 명령을 보낸다 — 이유를 말하고 막는다.
            reason: ex.plan.check ? null : t("today.check.noCheck"),
            busy: busy.has(id),
            busyLabel: t("today.busy.opening"),
            run: () => void busy.run(id, () => runInTerminal(recheckPrompt(ex))),
          },
          { id: "plan", label: t("today.check.openPlan"), run: () => openPlan(ex.plan.plan_id) },
        ];
      }
      case "autoBlocked": {
        // 볼 것은 그 줄에 다 있다 — 갈 곳이 없으니 「알았어요」 하나. 믿는 자리를 알려 주는 것은 Claude 의 자동 모드 설정이다.
        const id = `dismiss:${ex.key}`;
        return [
          {
            id,
            label: t("today.check.dismissWaiting"),
            busy: busy.has(id),
            run: () =>
              void busy.run(id, () =>
                hooksApi
                  .dismissBlocked(projectId)
                  .catch((e: unknown) => toast.destructive(t("today.check.dismissBlockedFailed", { error: tError(toAppError(e)) }))),
              ),
          },
        ];
      }
      case "unrecorded":
        return [{ id: "diff", label: t("today.check.viewChanges"), run: () => onNavigate("diff") }];
      case "silent": {
        // 일지 없이 끝난 대화 — 볼 변경이 아니라 맡길 일지다. 그 대화의 id 를 넘겨 일지 한 건을 부탁한다.
        const id = `ask:${ex.key}`;
        const ids = ex.signals.map((s) => s.session_id).join(", ");
        return [
          {
            id,
            label: t("today.check.askJournal"),
            busy: busy.has(id),
            busyLabel: t("today.busy.opening"),
            run: () => void busy.run(id, () => runInTerminal(t("today.check.askJournalPrompt", { ids }))),
          },
        ];
      }
      case "blocked":
      case "decision":
        return [{ id: "plan", label: t("today.check.openPlan"), run: () => openPlan(ex.planId) }];
      case "plugin":
        // 플러그인이 앱보다 새 판이면 올릴 것은 앱이다 — 설정의 업데이트 칸으로.
        if (ex.ahead) {
          return [
            {
              id: "update",
              label: t("today.pluginDrift.checkUpdate"),
              run: () => {
                onNavigate("settings");
                openSettings("data");
              },
            },
          ];
        }
        return [{ id: "copy", label: t("today.pluginDrift.copy"), busy: busy.has("copyPlugin"), run: copyPluginUpdate }];
    }
  };

  // 「N건 더」 는 일지 화면의 「검증 없는 것만」 으로 간다(합류 G-11) — 남은 줄은 그 거르기가 하는 일이다. 예전엔
  // 제자리에서 펼쳐 이 화면이 둘째 일지 목록이 됐다. 거르기는 일지 화면의 지역 상태라 요청을 실어 보낸다. 요청은
  // 이 날을 싣는다(SCR-05) — 「3건 더」 는 오늘의 수인데 일지 화면이 지난 모든 날(38줄)을 세웠다.
  const unreadShown = split ? split.unread.slice(0, UNREAD_LIMIT) : [];
  const openUnverified = () => {
    requestOnlyMissing(workday);
    onNavigate("journal");
  };
  const navRows: NavRow[] = split ? [...split.first, ...(next ? [NEXT_ROW] : []), ...unreadShown] : [];
  const navSig = navRows.map((r) => r.key).join("\n");
  const focusIndex = navRows.length === 0 ? -1 : Math.min(Math.max(active, 0), navRows.length - 1);

  const navFor = (i: number): RowNav => ({
    index: i,
    active: active >= 0 && i === active,
    tabIndex: i === focusIndex ? 0 : -1,
    rowRef: (el) => {
      rowRefs.current[i] = el;
    },
  });

  const focusRow = (i: number) => {
    setActive(i);
    rowRefs.current[i]?.focus();
  };

  // 행 수가 바뀌면 지금 행을 범위 안으로. 포커스가 남은 행의 자리가 바뀌었으면(위에 행이 끼거나 빠짐) 따라 옮긴다.
  useLayoutEffect(() => {
    const len = navRows.length;
    rowRefs.current.length = len;
    const host = document.activeElement?.closest<HTMLElement>("[data-row]");
    const at = host && rootRef.current?.contains(host) ? Number(host.dataset.row) : -1;
    if (at >= 0) {
      if (at !== activeRef.current) setActive(at);
    } else if (activeRef.current >= len) {
      setActive(len - 1);
    }
  }, [navSig, navRows.length]);

  // 포커스를 가진 것이 빠지면(v · 읽음 · 알았어요 · 모두 읽음 · 다시 시도 · 보낸 뒤의 보내기) 포커스가 body 로
  // 떨어진다 — 그 자리로 되돌려 v 를 연달아 누르는 흐름이 끊기지 않게: 행 안이었으면 같은 자리(없으면 앞) 행,
  // 행 밖 컨트롤이면 그것이 적어 둔 자리(`data-land`), 그것도 없으면 지금 행, 행이 하나도 없으면 화면. 무엇이
  // 빠지게 했는지(저장소 · 단추의 지역 상태)와 상관없이 그린 뒤마다 본다 — 빠진 것이 없으면 첫 줄에서 돌아간다.
  useLayoutEffect(() => {
    const last = lastFocus.current;
    if (!last || last.el.isConnected) return;
    const ae = document.activeElement;
    if (ae && ae !== document.body) return; // 포커스가 이미 어딘가에 있다 — 빼앗지 않는다.
    const len = navRows.length;
    const want = last.land ?? activeRef.current;
    const i = want >= 0 && len > 0 ? Math.min(want, len - 1) : -1;
    // 「지금 행」 은 포커스가 들면서 `onFocusCapture` 가 맞춘다 — 여기서 상태를 바꾸지 않는다(그린 뒤마다 도는 이펙트다).
    (rowRefs.current[i] ?? rootRef.current)?.focus({ preventScroll: true });
  });

  const onFocusCapture = (e: FocusEvent<HTMLDivElement>) => {
    if (!(e.target instanceof HTMLElement)) return;
    const landAt = e.target.closest<HTMLElement>("[data-land]")?.dataset.land;
    lastFocus.current = { el: e.target, land: landAt != null ? Number(landAt) : null };
    // 행 안 어디든(행 자신이든 그 안의 단추든) 포커스가 들면 그 행이 「지금 행」 이다 — 단추에서 행을 빼도
    // 낡은 자리로 튀지 않게.
    const host = e.target.closest<HTMLElement>("[data-row]");
    if (host) setActive(Number(host.dataset.row));
  };
  const onBlurCapture = (e: FocusEvent<HTMLDivElement>) => {
    // 화면 밖의 무언가로 옮겼다 — 사람이 고른 것이다. (빠지면서 잃은 포커스는 옮겨 갈 곳이 없어 `null` 이다.)
    if (e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) lastFocus.current = null;
  };

  /** 행에서 누른 ↩ — 질문은 답 칸으로, 일지는 그 일지로, 그 밖은 첫 동작. */
  const enterRow = (row: NavRow, host: HTMLElement) => {
    if (row.kind === "next") return runNext();
    if (row.kind === "question") return host.querySelector<HTMLInputElement>(".tdy-answer-input")?.focus();
    if (row.kind === "evidence") return openEntry(row.entry);
    actionsFor(row)
      .find((a) => !a.reason)
      ?.run();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (isTyping(e.target)) return;
    const c = readChord(e);
    if (c.mod || c.alt) return;
    const len = navRows.length;
    const host = e.target instanceof Element ? e.target.closest<HTMLElement>("[data-row]") : null;
    const at = host ? Number(host.dataset.row) : -1;
    const cur = at >= 0 ? at : Math.min(active, len - 1);
    // 방향키 · Home/End 는 행 안에서만 — 화면에 포커스가 있을 때는 본래대로 스크롤한다.
    const inList = at >= 0;
    switch (c.key) {
      case "j":
      case "k":
      case "ArrowDown":
      case "ArrowUp": {
        const down = c.key === "j" || c.key === "ArrowDown";
        if (len === 0 || (!inList && c.key.startsWith("Arrow"))) return;
        e.preventDefault();
        return focusRow(down ? Math.min(cur + 1, len - 1) : Math.max(cur - 1, 0));
      }
      case "Home":
      case "End":
        if (!inList) return;
        e.preventDefault();
        return focusRow(c.key === "Home" ? 0 : len - 1);
      case "Escape":
        if (!inList) return;
        e.preventDefault();
        return rootRef.current?.focus({ preventScroll: true });
      case "Enter":
        // 행 안의 단추에서 누른 Enter 는 그 단추의 것이다.
        if (!host || e.target !== host) return;
        e.preventDefault();
        return enterRow(navRows[at], host);
      case "v": {
        // 보이는 「지금 행」 이 아니라 포커스가 든 행만 — 화면에 포커스가 있을 때 v 가 일지를 고쳐 쓰지 않게.
        const row = inList ? navRows[at] : undefined;
        if (row?.kind !== "evidence") return;
        e.preventDefault();
        return void verify(row.entry);
      }
      case "r":
        if (!inList || !next) return;
        e.preventDefault();
        return runNext();
    }
  };

  const entries = data.entries ?? [];
  const live = sessions ? liveSessionsOf(sessions, entries) : [];
  const multiAgent = new Set(entries.map((e) => e.agent_id)).size > 1;
  const handOff = () => void busy.run("handoff", () => runInTerminal(t("today.local.handoffPrompt")));

  let main: ReactNode;
  if (error) {
    // 한 번도 못 읽었을 때만 — 앞 값이 있으면 그것을 그리고 「못 읽음」 은 카드 머리의 한 줄이다.
    main = <ErrorCard title={t("today.loadFailed")} error={error} onRetry={refresh} />;
  } else {
    main = (
      <>
        {firstRun ? (
          <FirstSteps
            connection={pluginConnection(data.plugin, getPlatform())}
            working={live.length > 0}
            onConnect={() => {
              onNavigate("settings");
              openSettings("agents");
            }}
            onOpenTerminal={() => onNavigate("terminal")}
            onHandOff={() => void busy.run("first", () => runInTerminal(t("today.first.step2Prompt")))}
            opening={busy.has("first")}
            receipt={<InitReceipt info={ws?.state.oculpmInitCard} />}
          />
        ) : null}
        <TodayExceptions
          split={split}
          next={next}
          entryCount={entries.length}
          unrecordedKnown={data.unrecorded != null}
          firstRun={firstRun}
          staleSince={staleSince}
          onRetry={refresh}
          navFor={navFor}
          actionsFor={actionsFor}
          onAnswer={answer}
          sent={sent}
          isSending={(id) => busy.some(`answer:${id}:`)}
          isBusy={busy.has}
          onRunNext={runNext}
        />
        <TodayUnread
          split={split}
          shown={unreadShown}
          offset={(split?.first.length ?? 0) + (next ? 1 : 0)}
          navFor={navFor}
          showAgent={multiAgent}
          teammates={data.teammates}
          onOpen={openEntry}
          onVerify={(entry) => void verify(entry)}
          onVerifyAll={(list) => void verifyAll(list)}
          onMore={openUnverified}
          isBusy={busy.has}
        />
        <LiveCard
          sessions={live}
          now={now}
          term={liveTerm(data.terms)}
          onShowTerminal={(id) => {
            requestTermFocus(id);
            onNavigate("terminal");
          }}
        />
      </>
    );
  }

  return (
    <>
      <Toolbar title={t("nav.today")} sub={dateLabel} find />
      <div className="scroll">
        <div
          ref={rootRef}
          className="page tdy"
          tabIndex={-1}
          onKeyDown={onKeyDown}
          onFocusCapture={onFocusCapture}
          onBlurCapture={onBlurCapture}
        >
          {!oculpmReady ? (
            <div className="tdy-body">
              <div className="card tdy-card tdy-pad tdy-notice">
                <span>{t("today.notActive")}</span>
                <button type="button" className="btn primary sm" onClick={requestOculpmActivate}>
                  {t("today.activateNow")}
                </button>
              </div>
            </div>
          ) : (
            <div className="tdy-body">
              <div className="tdy-col">
                <div className="tdy-day">
                  <span className="tdy-date">{dateLabel}</span>
                  <TodayNumbers
                    mine={split?.mine ?? []}
                    plans={data.digest?.plans ?? []}
                    arrived={data.arrived}
                    local={data.localOnly}
                    now={now}
                    onOpenPlan={openPlan}
                    onOpenEntry={(p) => openEntry({ relative_path: p })}
                    onOpenDiff={() => onNavigate("diff")}
                    onHandOff={handOff}
                    opening={busy.has("handoff")}
                  />
                </div>
                {/* 두 칸(10-30) — 왼쪽은 해야 할 것, 오른쪽은 기록. 오른쪽이 비어도 칸은 선다(값이 오면서 화면이
                    옆으로 옮기지 않게). 자리가 모자라면 flex-wrap 이 한 칸으로 접는다 — 접힘 선 숫자를 새로 고르지 않는다. */}
                <div className="tdy-cols">
                  <div className="tdy-main">{main}</div>
                  <div className="tdy-side">
                    {entries.length > 0 && data.digest ? (
                      <TodayWork entries={entries} digest={data.digest} onOpenEntry={openEntry} />
                    ) : null}
                  </div>
                </div>
                {/* 단축키는 늘 떠 있는 크롬이 아니라 두 칸 밖 맨 끝의 한 줄이다 — 한 칸에 두면 다른 칸 길이만큼
                    떨어져 홀로 떠 있거나, 접힌 창에서 예외 카드보다 먼저 섰다. */}
                {navRows.length > 0 ? <p className="tdy-keys">{t("today.kbd.hint")}</p> : null}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
