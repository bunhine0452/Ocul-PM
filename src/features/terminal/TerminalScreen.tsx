/**
 * 터미널 (4.0 다시, 플랜 `terminal-v4-20261029`) — 세션 탭 줄 + 칸 + 터미널.
 *
 * 세션은 앱 안에 살고(`termStore`), 화면을 오가도 계속 돈다. 처음 열면 셸 하나를 띄운다. 탭은 번호 · 이름과
 * **예외만** 말하고(`SessionTabs`), 칸 위에는 예외일 때만 상태 띠가 겹친다(`StatusBand`) — 기다림 · 일지 없음 ·
 * 끝남. 시작 뒤 일지 수는 툴팁으로 — 터미널에서 돈 일이 기록으로 남았는지는 「일지 없음」 이 말한다.
 *
 * 칸 나누기 (11-02, Orca 「split panes」) — 고른 칸을 오른쪽(⌘D) · 아래(⇧⌘D)로 몇 번이든 나눈다.
 * 모양은 `paneLayout.ts` 의 이진 트리, 그리기는 `PaneTree.tsx`. 모든 세션이 칸에 떠 있으면 탭 줄을 걷고
 * 칸 머리가 목록 노릇을 한다 — 같은 목록을 두 번 그리던 크롬 110px.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { toAppError } from "@/api/invoke";
import { oculpmApi } from "@/api/oculpm";
import { planApi } from "@/api/plan";
import { projectsApi } from "@/api/projects";
import { EmptyState } from "@/components/EmptyState";
import { X } from "@/components/Icons";
import { firstNext } from "@/features/today/todayModel";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import type { TermInfo } from "@/api/terminal";
import { kbd, readChord } from "@/lib/kbd";
import { getPlatform, isMac } from "@/lib/platform";
import { toast } from "@/lib/toast";
import {
  closeTerm,
  focusTerm,
  hasWorked,
  openTerm,
  pasteToTerm,
  setTermFontSize,
  subscribeTerms,
  termsSnapshot,
} from "./termStore";
import {
  equalize,
  hasLeaf,
  leaf,
  leaves,
  setRatio,
  show,
  splitLeaf,
  swapSession,
  syncView,
  type PaneDir,
  type PaneView,
} from "./paneLayout";
import { PaneTree, SPLIT_MIN } from "./PaneTree";
import { TermFindBar } from "./TermFindBar";
import { neighborOf, type PaneMove } from "./paneNav";
import { useTerminalFileDrop } from "./dropFiles";
import { interceptCloseKey } from "@/hooks/useWindowKeys";
import { useConfirm } from "@/hooks/useConfirm";
import { useMinuteTick } from "@/hooks/useSecondTick";
import { useOptionalSettings } from "@/contexts/SettingsContext";
import { terminalApi } from "@/api/terminal";
import { clampTermFont, termFontKey } from "./termFontSize";
import { laneOf, lanePathOf, rebindLane, useRace } from "./race";
import { RaceStartDialog, RaceStrip } from "./RacePanel";
import { onTermFocus, takeTermFocus } from "./focusRequest";
import { closePeek } from "./imagePeek";
import { TermImagePeekHost } from "./TermImagePeek";
import { TermFileMenuHost } from "./TermFileMenu";
import { runPromptInTerminal } from "./runPrompt";
import { sendOrQueue, toastQueued } from "./sendToClaude";
import { SessionDot, SessionTabs, SessionWord } from "./SessionTabs";
import { StatusBand, __resetStatusBandForTests, foldBand, hasBand, unfoldWorking } from "./StatusBand";
import { TermToolbar } from "./TermToolbar";
import {
  __resetSessionNumbersForTests,
  numberSessions,
  sessionLabel,
  sessionName,
  sessionNumber,
  sessionView,
} from "./status";
import "./terminal.css";

/** 첫 셸이 이보다 빨리 뜨면 「여는 중」 을 그리지 않는다 — 빈 화면이 깜빡이지 않게. */
const OPENING_QUIET_MS = 300;

/** 세션별 「시작 뒤 일지 수」 — 오늘 일지의 만든 시각을 세션 시작과 견준다. */
function useRecordsSince(projectId: number, workday: string | null, sessions: TermInfo[]): Map<number, number> {
  const [created, setCreated] = useState<number[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const off = projectsApi.onJournalAdded((pid) => {
      if (pid === projectId) setTick((n) => n + 1);
    });
    return () => void off.then((fn) => fn());
  }, [projectId]);
  useEffect(() => {
    if (!workday) return;
    let alive = true;
    void oculpmApi
      .listJournalEntries(projectId, workday)
      .then((list) => alive && setCreated(list.map((e) => Date.parse(e.created_at)).filter((n) => !Number.isNaN(n))))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [projectId, workday, tick]);
  const out = new Map<number, number>();
  for (const s of sessions) {
    const start = Date.parse(s.started_at);
    out.set(s.id, created.filter((c) => c >= start).length);
  }
  return out;
}

/** 오늘의 다음 항목 — 세션이 하나도 없을 때만 읽는다(빈 화면의 채운 단추). 읽기만 한다. */
function useNextItem(projectId: number, enabled: boolean) {
  const [next, setNext] = useState<{ planId: string; itemId: string; title: string } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    planApi
      .todayDigest(projectId)
      .then((d) => {
        const n = firstNext(d);
        if (alive) setNext(n ? { planId: n.plan.plan_id, itemId: n.item.item_id, title: n.item.title } : null);
      })
      .catch(() => alive && setNext(null));
    return () => {
      alive = false;
    };
  }, [projectId, enabled]);
  return enabled ? next : null;
}

/** 칸 트리와 고른 칸 — 화면을 오가도 기억한다(창 하나에 하나, 모듈 범위). */
let remembered: PaneView = { layout: null, active: null };

/**
 * 나누거나 다시 열며 프로젝트 루트 밖(레인 worktree)에서 연 세션의 폴더. 레인의 짝 세션은 `race` 가 알지만,
 * 레인 칸을 나눠 연 셸은 짝이 아니라서 다시 열면 루트에서 뜨고 파일 링크도 원래 체크아웃 기준으로 열렸다.
 */
const cwds = new Map<number, string>();

/** 세션이 도는 폴더 — `null` 이면 프로젝트 루트. */
function cwdOf(id: number): string | null {
  return lanePathOf(id) ?? cwds.get(id) ?? null;
}

/** 안에서 claude 가 도는가 — 「다음」 으로 띄웠거나, 셸에서 띄워 상태 신호를 보낸다. */
function runsClaude(s: TermInfo): boolean {
  return s.label === "claude" || s.status != null;
}

/** 테스트 전용 — 창 하나의 수명을 흉내 낸다. */
export function __resetTermLayoutForTests() {
  remembered = { layout: null, active: null };
  cwds.clear();
  __resetSessionNumbersForTests();
  __resetStatusBandForTests();
}

/** 터미널 단축키 — macOS 는 ⌘(⌃ 는 셸의 것), 그 밖은 터미널 가족(Ctrl+Shift+…, `readChord`). */
function termChord(e: KeyboardEvent): { shift: boolean; key: string } | null {
  if (isMac()) {
    if (!e.metaKey || e.ctrlKey || e.altKey) return null;
    const key = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : e.key.toLowerCase();
    return { shift: e.shiftKey, key };
  }
  const c = readChord(e, "terminal");
  return c.mod && !c.alt ? { shift: c.shift, key: c.key.toLowerCase() } : null;
}

/** 이전 · 다음 세션 — ⇧⌘[ / ⇧⌘] (macOS, iTerm · Terminal.app 과 같은 키), 그 밖 Ctrl+PageUp / PageDown. */
function sessionStepOf(e: KeyboardEvent): -1 | 1 | null {
  if (isMac()) {
    if (!e.metaKey || !e.shiftKey || e.ctrlKey || e.altKey) return null;
    return e.code === "BracketLeft" ? -1 : e.code === "BracketRight" ? 1 : null;
  }
  if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return null;
  return e.key === "PageUp" ? -1 : e.key === "PageDown" ? 1 : null;
}

const ARROWS: Record<string, PaneMove> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

/** ⌥⌘ + 방향키(macOS) · Ctrl+Alt + 방향키(그 밖) → 칸 이동 방향. */
function paneMoveOf(e: KeyboardEvent): PaneMove | null {
  const dir = ARROWS[e.key];
  if (!dir || e.shiftKey) return null;
  const held = isMac() ? e.metaKey && e.altKey && !e.ctrlKey : e.ctrlKey && e.altKey && !e.metaKey;
  return held ? dir : null;
}

/**
 * 터미널 단축키가 물러날 때 — 다른 처리기가 이미 받았거나(defaultPrevented), 대화상자(레인 변경 · 닫기 확인) ·
 * 크게 본 미리보기 · 팝오버 메뉴(파일 · 「새 세션 ▾」 · 숨은 세션 「+N」)가 떠 있거나, 화면 밖 입력칸(⌘K 팔레트)의
 * 키. 예전엔 window 캡처라 대화상자 뒤에서 ⌘F 가 막대를 열며 포커스를 빼앗고 ⌘T 가 세션을 열었다
 * (`useNavGestures` 는 이미 물러난다). 메뉴가 열린 채 ⌘T 면 새 세션이 포커스를 가져가고 메뉴만 남았다.
 */
function yieldsToOverlay(e: KeyboardEvent): boolean {
  if (e.defaultPrevented) return true;
  if (document.querySelector('[aria-modal="true"], .tm-file-menu, .tm-menu, .tm-more-pop')) return true;
  const el = e.target instanceof Element ? e.target : null;
  return !!el && !el.closest(".tm-split") && el.matches("input, textarea, select, [contenteditable='true']");
}

export function TerminalScreen({
  projectId,
  workday,
  projectRoot = null,
}: {
  projectId: number;
  workday: string | null;
  /** 경로 메뉴(Finder · 미리보기 · 편집기)가 프로젝트 안쪽인지 재는 루트. */
  projectRoot?: string | null;
}) {
  const { t } = useT();
  const sessions = useSyncExternalStore(subscribeTerms, termsSnapshot);
  // 번호는 연 순서(id 순) — 「Claude 에게 보내기」 · 알림이 같은 번호를 부른다(`status.sessionNumber`).
  numberSessions(sessions);
  // 칸 나누기 (Orca 「split panes」) — 칸 트리 + 고른 칸. 오늘의 「Claude 가 기다려요」 줄에서 왔으면 그 세션부터.
  const [view, setViewState] = useState<PaneView>(() => {
    const ids = sessions.map((s) => s.id);
    const v = syncView(remembered, ids);
    const asked = takeTermFocus();
    return asked != null && ids.includes(asked) ? show(v, asked) : v;
  });
  const setView = useCallback((fn: (v: PaneView) => PaneView) => {
    setViewState((prev) => (remembered = fn(prev)));
  }, []);
  const { layout, active } = view;
  // 터미널 찾기 (⌘F) — 고른 칸 위에 한 줄, 연 세션의 것. 다른 칸을 고르면 닫는다(그 렌더에 새 칸 위로 잠깐 서며
  // 새 칸의 선택까지 지우던 것 — 막대는 연 세션 위에만 선다). ⌘F 마다 `findSeq` 가 올라 찾기 칸으로 돌아온다.
  const [finding, setFinding] = useState<number | null>(null);
  const [findSeq, setFindSeq] = useState(0);
  // 한 칸 크게 (Orca 「Expand pane」 ⇧⌘↩) — 트리는 그대로 두고 고른 칸만 그린다.
  const [zoomed, setZoomed] = useState(false);
  const panesRef = useRef<HTMLDivElement | null>(null);
  const opening = useRef(false);
  // 첫 셸을 여는 중 · 못 열었음 — 세션이 없을 때 빈 화면이 깜빡이거나 토스트만 남지 않게. 세션 없이 서면 첫 렌더부터
  // 「여는 중」 — 「idle」 로 시작하면 빈 화면 카드(채운 단추)가 한 번 그려지고 쓰지 않을 다음 항목도 읽었다.
  const [openState, setOpenState] = useState<{ phase: "idle" | "opening" | "slow" | "failed"; error?: string }>(() =>
    termsSnapshot().length === 0 ? { phase: "opening" } : { phase: "idle" },
  );
  // 같은 일을 worktree 여럿에서 (Orca 벤치마킹 #worktree-race) — 시작 대화상자. 레인 띠는 RaceStrip.
  const [raceOpen, setRaceOpen] = useState(false);
  const race = useRace(); // 레인 ↔ 세션 짝이 바뀌면 탭 이름(「시도 n」) · 일지 수를 다시 그린다
  // 나누려고(다시 열려고) 연 세션은 「새 세션이면 고른 칸에」 규칙에서 뺀다 — 고른 칸을 빼앗지 않게.
  const openingSplit = useRef(false);
  const records = useRecordsSince(projectId, workday, sessions);
  const { confirm, confirmDialog } = useConfirm();
  // 「최근 소식 없음」(작업 중 30분) 이 제때 서도록 — 일하는 세션이 있을 때만 1분마다 다시 그린다.
  useMinuteTick(sessions.some((s) => s.alive && s.status?.state === "working"));
  // 글자 크기 (⌘= / ⌘- / ⌘0) — 설정에 남겨 모든 창이 같은 크기.
  const settingsCtx = useOptionalSettings();
  const fontPx = clampTermFont(settingsCtx?.settings.terminalFontSize ?? 13);
  const fontRef = useRef(fontPx);
  fontRef.current = fontPx;
  useEffect(() => {
    setTermFontSize(fontPx);
  }, [fontPx]);
  const setFont = useCallback(
    (px: number) => {
      if (settingsCtx) void settingsCtx.set("terminalFontSize", px);
      else setTermFontSize(px);
    },
    [settingsCtx],
  );

  // 레인 세션의 일지 수는 그 worktree 의 것 — 띠와 탭이 같은 레인을 다르게 말하지 않게.
  const recordsOf = (s: TermInfo) => {
    const lane = laneOf(s.id);
    return lane ? (lane.journals ?? 0) : (records.get(s.id) ?? 0);
  };
  const viewOf = (s: TermInfo) => sessionView(t, s, hasWorked(s.id), recordsOf(s));

  // 세션 닫기 — 안에서 무언가 돌고 있으면(Claude 가 일하는 중 등) 먼저 묻는다. 빈 셸은 바로.
  const closeSession = useCallback(
    async (id: number) => {
      const live = await terminalApi.list().catch(() => []);
      const s = live.find((x) => x.id === id);
      if (s?.busy) {
        const ok = await confirm({
          title: t("terminal.closeOneAsk.title", { name: sessionLabel(t, s) }),
          message: t("terminal.closeOneAsk.body"),
          confirmLabel: t("terminal.closeAsk.confirm"),
          danger: true,
        });
        if (!ok) return;
      }
      closeTerm(id);
    },
    [confirm, t],
  );

  const add = useCallback(async () => {
    if (opening.current) return;
    opening.current = true;
    setOpenState({ phase: "opening" });
    const slow = setTimeout(
      () => setOpenState((o) => (o.phase === "opening" ? { phase: "slow" } : o)),
      OPENING_QUIET_MS,
    );
    try {
      const id = await openTerm(projectId);
      setView((v) => show(v, id));
      setOpenState({ phase: "idle" });
    } catch (e) {
      const error = tError(toAppError(e));
      // 세션이 있으면 화면이 그대로라 이유는 알림으로 — 없으면 빈 화면이 이유와 「다시 시도」 를 말한다.
      if (termsSnapshot().length > 0) {
        setOpenState({ phase: "idle" });
        toast.destructive(t("terminal.openFailed", { error }));
      } else {
        setOpenState({ phase: "failed", error });
      }
    } finally {
      clearTimeout(slow);
      opening.current = false;
    }
  }, [projectId, setView, t]);

  // 처음 열면 셸 하나 — 빈 화면에서 단추부터 찾게 하지 않는다. 그 사이 세션이 생겼으면 「여는 중」 을 거둔다.
  useEffect(() => {
    if (termsSnapshot().length === 0) void add();
    else setOpenState((o) => (o.phase === "opening" ? { phase: "idle" } : o));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 접어 둔 「일지 없음」 띠는 Claude 가 다시 일하면 편다 — 칸에 없는(탭에만 있는) 세션도 보게 화면이 넘긴다.
  useEffect(() => unfoldWorking(sessions), [sessions]);

  // 세션이 닫히면 그 칸을 접고, 새 세션이 생기면(「다음」 실행 · 레인) 고른 칸에 띄운다.
  const lastId = sessions[sessions.length - 1]?.id ?? null;
  const prevLast = useRef(lastId);
  useEffect(() => {
    const grew = lastId !== prevLast.current && lastId != null;
    prevLast.current = lastId;
    const ids = sessions.map((s) => s.id);
    if (grew && openingSplit.current) {
      openingSplit.current = false;
      return;
    }
    setView((v) => {
      const next = syncView(v, ids);
      return grew && !hasLeaf(next.layout, lastId) ? show(next, lastId) : next;
    });
  }, [lastId, sessions, setView]);

  const count = leaves(layout).length;
  // 단축키 처리기는 칸 수를 닫아 두지 않고 ref 로 읽는다 — 나눈 직후 처리기가 다시 걸리기 전에 온 ⇧⌘↩ 도 맞게.
  const countRef = useRef(count);
  countRef.current = count;
  const activeRef = useRef(active);
  activeRef.current = active;
  const sessionIdsRef = useRef<number[]>([]);
  sessionIdsRef.current = sessions.map((s) => s.id);
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  // 칸이 하나가 되면 「크게」는 뜻이 없다.
  useEffect(() => {
    if (count < 2) setZoomed(false);
  }, [count]);

  // 고른 칸에 그 방향으로 나눌 자리가 있는가 — 단축키는 알림으로, 메뉴는 미리 이유를 단다.
  const roomFor = useCallback((dir: PaneDir) => {
    const id = activeRef.current;
    const pane = id == null ? null : panesRef.current?.querySelector<HTMLElement>(`[data-term-id="${id}"]`);
    const room = dir === "row" ? pane?.clientWidth : pane?.clientHeight;
    return !(room != null && room > 0 && room < (dir === "row" ? 2 * SPLIT_MIN.row : 2 * SPLIT_MIN.col));
  }, []);

  // 고른 칸을 나눈다 — 새 셸은 그 칸의 폴더(레인이면 그 worktree)에서. 칸이 너무 좁으면 나누지 않는다.
  const split = useCallback(
    async (dir: PaneDir) => {
      if (opening.current || active == null) return;
      if (!roomFor(dir)) {
        toast.info(t("terminal.splitNoRoom"));
        return;
      }
      opening.current = true;
      openingSplit.current = true;
      try {
        const cwd = cwdOf(active);
        const id = await openTerm(projectId, null, cwd);
        if (cwd) cwds.set(id, cwd);
        setZoomed(false);
        setView((v) =>
          v.layout && v.active != null ? { layout: splitLeaf(v.layout, v.active, id, dir), active: id } : show(v, id),
        );
      } catch (e) {
        openingSplit.current = false;
        toast.destructive(t("terminal.openFailed", { error: tError(toAppError(e)) }));
      } finally {
        opening.current = false;
      }
    },
    [active, projectId, roomFor, setView, t],
  );

  // 「다시 열기」 가 대화를 잇는가 — claude 로 연 세션이고, 같은 폴더에서 다른 claude 가 돌고 있지 않을 때만.
  // `claude --continue` 는 **그 폴더의 가장 최근** 대화를 연다: 같은 폴더의 다른 세션이 살아 있으면 그쪽 대화를
  // 이어 한 대화에 Claude 둘이 번갈아 썼다. 레인은 폴더에 세션이 하나뿐이라 그대로 잇는다.
  const resumes = useCallback((id: number) => {
    const list = sessionsRef.current;
    if (list.find((s) => s.id === id)?.label !== "claude") return false;
    const cwd = cwdOf(id);
    return !list.some((s) => s.id !== id && s.alive && runsClaude(s) && cwdOf(s.id) === cwd);
  }, []);

  // 끝난 세션을 같은 자리(같은 폴더 · 레인)에서 다시 연다 — 잇는 것은 `resumes` 가 정한다.
  // 새 세션은 그 칸에 앉고, 끝난 세션은 닫는다.
  const reopen = useCallback(
    async (id: number) => {
      const old = sessionsRef.current.find((s) => s.id === id);
      if (!old || opening.current) return;
      opening.current = true;
      openingSplit.current = true;
      try {
        const cwd = cwdOf(id);
        const next = await openTerm(projectId, null, cwd, resumes(id));
        if (cwd && lanePathOf(id) == null) cwds.set(next, cwd);
        rebindLane(id, next);
        setView((v) => swapSession(v, id, next));
        closeTerm(id);
      } catch (e) {
        openingSplit.current = false;
        toast.destructive(t("terminal.openFailed", { error: tError(toAppError(e)) }));
      } finally {
        opening.current = false;
      }
    },
    [projectId, resumes, setView, t],
  );

  // 「기록 남기게 하기」 — 일지 없이 손을 놓은 Claude 에게 기록을 부탁한다(쉬지 않으면 줄에 세운다). 띠는 낡은 상태로도
  // 선다 — claude 가 `state=clear` 없이 죽으면 idle 이 남고 셸이 앞에 선다. `sendOrQueue` 가 목록을 다시 읽어 그 칸에
  // Claude 가 없으면 넣지 않는다(셸에 그 부탁이 명령으로 들어갔다) — 그러면 띠를 접고 까닭을 알린다.
  const askRecord = useCallback(
    async (id: number) => {
      try {
        const res = await sendOrQueue(id, t("terminal.askRecordPrompt"));
        if (res.outcome === "sent") toast.info(t("send.sent", { n: sessionNumber(id) }));
        else if (res.outcome === "absent") {
          foldBand(id);
          toast.warning(t("terminal.noClaude", { n: sessionNumber(id) }));
        } else toastQueued(t, sessionNumber(id), res.key);
      } catch (e) {
        toast.destructive(t("send.failed", { error: tError(toAppError(e)) }));
      }
    },
    [t],
  );

  // 탭 · 칸을 고른다 — 칸에 없던 세션이면 고른 칸에 갈아 끼운다. 키보드로 탭을 옮길 때 · 칸의 띠나 머리 단추로
  // 포커스가 들어올 때는 입력을 넘기지 않는다. 갈아 끼운 칸이 화면을 붙이며 포커스를 가져가지 않게 `PaneTree`
  // 에도 넘긴다 — 그 칸의 `mountTerm` 이 고른 칸이면 입력에 포커스를 줘, 다음 화살표가 셸 · Claude 로 갔다.
  const keepFocus = useRef(false);
  const pick = useCallback(
    (id: number, keep = false) => {
      keepFocus.current = keep && id !== activeRef.current;
      setView((v) => show(v, id));
    },
    [setView],
  );

  // 고른 칸이 바뀌면 입력도 그리로 — 찾기 줄은 닫는다(다른 세션의 출력이다).
  useEffect(() => {
    setFinding((f) => (f === active ? f : null));
    if (active == null) return;
    if (keepFocus.current) {
      keepFocus.current = false;
      return;
    }
    focusTerm(active);
  }, [active]);

  // 화면이 서 있는 동안 온 「이 세션을 보여 줘」.
  useEffect(() => onTermFocus((id) => pick(id)), [pick]);

  const openFind = useCallback(() => {
    if (activeRef.current == null) return;
    setFinding(activeRef.current);
    setFindSeq((n) => n + 1);
  }, []);

  // 새 세션 ⌘T · 오른쪽으로 나누기 ⌘D · 아래로 ⇧⌘D · 한 칸 크게 ⇧⌘↩ (Orca 기본값).
  // 그 밖 OS 는 셸 키에 Shift 를 하나 더 — Ctrl+Shift+T · Ctrl+Shift+D · Ctrl+Alt+Shift+D · Ctrl+Shift+Enter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (yieldsToOverlay(e)) return;
      // 글자 크기 ⌘= / ⌘- / ⌘0.
      const px = termFontKey(e, fontRef.current);
      if (px != null) {
        e.preventDefault();
        e.stopPropagation();
        setFont(px);
        return;
      }
      // 이전 · 다음 세션 ⇧⌘[ / ⇧⌘] — 탭 줄 순서로 돈다.
      const step = sessionStepOf(e);
      if (step != null) {
        const ids = sessionIdsRef.current;
        if (ids.length < 2) return;
        e.preventDefault();
        e.stopPropagation();
        const at = ids.indexOf(activeRef.current ?? -1);
        pick(ids[(at + step + ids.length) % ids.length]);
        return;
      }
      // 칸 사이 이동 ⌥⌘ + 방향키 (그 밖 Ctrl+Alt + 방향키) — 화면의 칸 자리로 고른다(`paneNav`).
      const move = paneMoveOf(e);
      if (move) {
        const from = activeRef.current;
        const box = panesRef.current;
        if (from == null || !box || countRef.current < 2) return;
        e.preventDefault();
        e.stopPropagation();
        const rects = [...box.querySelectorAll<HTMLElement>(".tm-pane[data-term-id]")].map((el) => {
          const r = el.getBoundingClientRect();
          return { id: Number(el.dataset.termId), x: r.left, y: r.top, w: r.width, h: r.height };
        });
        const to = neighborOf(rects, from, move);
        if (to != null) pick(to);
        return;
      }
      const c = termChord(e);
      if (!c) return;
      if (c.key === "t" && !c.shift) {
        e.preventDefault();
        void add();
      } else if (c.key === "d") {
        e.preventDefault();
        void split(c.shift ? "col" : "row");
      } else if (c.key === "f" && !c.shift) {
        e.preventDefault();
        openFind();
      } else if (c.key === "enter" && c.shift && countRef.current > 1) {
        e.preventDefault();
        setZoomed((z) => !z);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [add, split, pick, setFont, openFind]);

  // Finder 에서 끌어다 놓은 파일 · 그림 → 커서 아래 세션의 입력에 따옴표 친 경로.
  const dropOver = useTerminalFileDrop(active, getPlatform() === "windows", pasteToTerm);

  // ⌘W — 세션이 둘 이상이면 고른 세션만 닫는다. 하나 남으면 창을 닫는다(돌고 있으면 창 닫기 확인이 묻는다).
  // 대화상자(보내기 · 나란히 돌리기 · 변경 보기)가 떠 있으면 키만 삼킨다 — 앱 메뉴를 거쳐 와 다른 단축키처럼
  // 물러나지 못했고, 대화상자 뒤의 고른 세션을 닫았다(빈 셸이면 묻지도 않고). `false` 면 창이 닫힌다.
  const sessionCountRef = useRef(sessions.length);
  sessionCountRef.current = sessions.length;
  useEffect(
    () =>
      interceptCloseKey(() => {
        if (document.querySelector('[aria-modal="true"]')) return true;
        const id = activeRef.current;
        if (id == null || sessionCountRef.current < 2) return false;
        void closeSession(id);
        return true;
      }),
    [closeSession],
  );

  // 다른 화면으로 가면 미리보기도 닫는다 — 돌아왔을 때 크게 띄운 그림이 남아 있지 않게.
  useEffect(() => closePeek, []);

  // 크게 보는 동안 가려진 칸의 탭은 「칸에 떠 있음」 이 아니다.
  const shown = new Set(zoomed && active != null ? [active] : leaves(layout));
  const byId = (id: number) => sessions.find((x) => x.id === id);
  // 칸이 둘 이상이면 칸마다 머리 한 줄 — 어느 칸이 어느 세션인지 · 고른 칸이 어디인지. 기다림 · 끝남 · 일지 없음은
  // 바로 아래 띠가 까닭과 함께 말하니 머리는 점만(같은 낱말을 두 번 쓰지 않는다).
  const paneHead = (id: number) => {
    const s = count > 1 ? byId(id) : undefined;
    if (!s) return null;
    const v = viewOf(s);
    return (
      <div className="tm-pane-head">
        <SessionDot view={v} />
        <span className="tm-num">{sessionNumber(s.id)}</span>
        <span className="tm-name" title={v.plain}>
          {sessionName(t, s)}
        </span>
        {hasBand(s, v) ? null : <SessionWord view={v} />}
        {zoomed ? <span className="tm-meta">{t("terminal.zoomed", { key: kbd("⇧⌘↩", "terminal") })}</span> : null}
        <span className="tm-note-sp" />
        <button
          type="button"
          className="iconbtn sm"
          aria-label={t("terminal.closeAria", { name: sessionLabel(t, s) })}
          title={t("terminal.closeAria", { name: sessionLabel(t, s) })}
          onClick={() => void closeSession(s.id)}
        >
          <X size={13} aria-hidden="true" />
        </button>
      </div>
    );
  };
  // 띠의 「닫기」 는 끝난 세션에만 선다 — 안에서 도는 것이 없으니 묻지 않고 닫는다.
  const band = (id: number) => {
    const s = byId(id);
    return s ? (
      <StatusBand
        info={s}
        view={viewOf(s)}
        resumes={!s.alive && resumes(id)}
        onAskRecord={askRecord}
        onReopen={reopen}
        onClose={closeTerm}
      />
    ) : null;
  };
  // 기다리는 칸(고른 칸이 아닐 때)은 1px 앰버 테, 끝난 칸은 흐리게 — 마지막 화면이 산 것처럼 남지 않게.
  const leafClass = (id: number) => {
    const s = byId(id);
    if (!s) return "";
    if (!s.alive) return "is-ended";
    return id !== active && viewOf(s).mark === "wait" ? "is-wait" : "";
  };
  const current = active != null ? (byId(active) ?? null) : null;
  // 고른 세션의 폴더 — 파일 메뉴는 이 체크아웃 기준(레인이면 그 worktree, 레인 칸을 나눈 셸도), 머리에 「시도 n」.
  const activeCwd = active != null ? cwdOf(active) : null;
  const activeLane = activeCwd == null ? -1 : race.lanes.findIndex((l) => l.path === activeCwd);
  const tabsNeeded = sessions.length > 1 && sessions.some((s) => !shown.has(s.id));
  const empty = sessions.length === 0 && openState.phase === "idle";
  const next = useNextItem(projectId, empty);
  const runNext = async () => {
    if (!next) return;
    try {
      const res = await planApi.dispatchPrompt(projectId, next.planId, next.itemId);
      await runPromptInTerminal(projectId, res.prompt);
    } catch (e) {
      toast.destructive(t("plan.dispatchFailed", { error: tError(toAppError(e)) }));
    }
  };
  return (
    <>
      <TermToolbar
        hasSessions={sessions.length > 0}
        count={count}
        zoomed={zoomed}
        roomFor={roomFor}
        onNew={() => void add()}
        onSplit={(dir) => void split(dir)}
        onUnsplit={() => setView((v) => (v.active != null ? { layout: leaf(v.active), active: v.active } : v))}
        onRace={() => setRaceOpen(true)}
        onFind={openFind}
        onZoom={() => setZoomed((z) => !z)}
      />
      <div className="tm-split">
        <RaceStrip projectId={projectId} />
        {sessions.length === 0 ? (
          openState.phase === "slow" ? (
            <p className="tm-empty">{t("terminal.opening")}</p>
          ) : openState.phase === "failed" ? (
            <EmptyState
              density="rich"
              className="tm-empty-state"
              actions={
                <button type="button" className="btn primary" onClick={() => void add()}>
                  {t("common.retry")}
                </button>
              }
            >
              {t("terminal.openFailed", { error: openState.error ?? "" })}
            </EmptyState>
          ) : empty ? (
            <EmptyState
              density="rich"
              className="tm-empty-state"
              actions={
                // 빈 화면의 단추는 일지 · 계획의 빈 화면과 같은 크기(30px) — 터미널만 26px 이었다(RC-13).
                next ? (
                  <>
                    <button type="button" className="btn primary" onClick={() => void runNext()}>
                      {t("terminal.runNext")}
                    </button>
                    <button type="button" className="btn" onClick={() => void add()}>
                      {t("terminal.emptyShell")}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn primary"
                    aria-keyshortcuts="Meta+T Control+Shift+T"
                    onClick={() => void add()}
                  >
                    {t("terminal.new")}
                    <kbd className="kbd" aria-hidden="true">
                      {kbd("⌘T", "terminal")}
                    </kbd>
                  </button>
                )
              }
            >
              {next ? t("terminal.emptyNext", { title: next.title }) : t("terminal.empty")}
            </EmptyState>
          ) : null
        ) : null}
        {tabsNeeded ? (
          // 일부가 칸 밖이면 위 탭 줄 — 왼쪽 목록 칸은 일지 · 계획 목록 칸과 두 겹이었다 (화면 검사 #term-col).
          <SessionTabs
            sessions={sessions}
            active={active}
            shown={shown}
            viewOf={viewOf}
            recordsOf={recordsOf}
            onPick={pick}
            onClose={(id) => void closeSession(id)}
          />
        ) : null}
        <div className="tm-panes" ref={panesRef}>
          {layout ? (
            <PaneTree
              node={zoomed && active != null ? leaf(active) : layout}
              active={active}
              holdFocus={keepFocus}
              dropOver={dropOver}
              dropHint={t("terminal.drop.hint")}
              head={paneHead}
              band={band}
              leafClass={leafClass}
              onActivate={pick}
              onRatio={(path, ratio) => setView((v) => (v.layout ? { ...v, layout: setRatio(v.layout, path, ratio) } : v))}
              onEqualize={() => setView((v) => (v.layout ? { ...v, layout: equalize(v.layout) } : v))}
              separatorLabel={t("terminal.divider")}
              separatorHelp={t("terminal.dividerHelp")}
              overlay={
                current && finding === current.id ? (
                  <TermFindBar
                    id={current.id}
                    seq={findSeq}
                    claude={runsClaude(current)}
                    onClose={() => setFinding(null)}
                  />
                ) : null
              }
            />
          ) : null}
        </div>
      </div>
      <TermImagePeekHost />
      <TermFileMenuHost projectRoot={activeCwd ?? projectRoot} lane={activeLane >= 0 ? activeLane + 1 : null} />
      {confirmDialog}
      {raceOpen ? <RaceStartDialog projectId={projectId} onClose={() => setRaceOpen(false)} /> : null}
    </>
  );
}
