/**
 * 터미널 (4.0 다시, 플랜 `terminal-v4-20261029`) — 왼쪽 세션 목록 한 칸 + 터미널.
 *
 * 다른 화면과 같은 꼴이다(작업 일지 · 계획 · 변경 = 목록 한 칸 + 본문). 세션 줄은 이름 ·
 * 도는 중/끝남 · **시작 뒤 일지 수** — 터미널에서 돈 일이 기록으로 남았는지 한눈에 본다.
 * 세션은 앱 안에 살고(`termStore`), 화면을 오가도 계속 돈다. 처음 열면 셸 하나를 띄운다.
 *
 * 칸 나누기 (11-02, Orca 「split panes」) — 고른 칸을 오른쪽(⌘D) · 아래(⇧⌘D)로 몇 번이든 나눈다.
 * 모양은 `paneLayout.ts` 의 이진 트리, 그리기는 `PaneTree.tsx`. 10-30 의 「나란히」(두 칸 고정)를 대신한다.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { toAppError } from "@/api/invoke";
import { oculpmApi } from "@/api/oculpm";
import { projectsApi } from "@/api/projects";
import { Columns2, GitBranchIcon, Plus, Rows2, X } from "@/components/Icons";
import { Toolbar } from "@/components/Toolbar";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import type { TermInfo } from "@/api/terminal";
import { kbd, readChord } from "@/lib/kbd";
import { getPlatform, isMac } from "@/lib/platform";
import { toast } from "@/lib/toast";
import { closeTerm, focusTerm, openTerm, pasteToTerm, subscribeTerms, termsSnapshot } from "./termStore";
import {
  equalize,
  hasLeaf,
  leaf,
  leaves,
  setRatio,
  show,
  splitLeaf,
  syncView,
  type PaneDir,
  type PaneView,
} from "./paneLayout";
import { PaneTree, SPLIT_MIN } from "./PaneTree";
import { TermFindBar } from "./TermFindBar";
import { neighborOf, type PaneMove } from "./paneNav";
import { useTerminalFileDrop } from "./dropFiles";
import { laneNumberOf, lanePathOf, useRace } from "./race";
import { RaceStartDialog, RaceStrip } from "./RacePanel";
import { onTermFocus, takeTermFocus } from "./focusRequest";
import { closePeek } from "./imagePeek";
import { TermImagePeekHost } from "./TermImagePeek";
import { TermFileMenuHost } from "./TermFileMenu";
import { needsMe, sessionWord } from "./status";
import "./terminal.css";

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

/** 칸 트리와 고른 칸 — 화면을 오가도 기억한다(창 하나에 하나, 모듈 범위). */
let remembered: PaneView = { layout: null, active: null };

/** 테스트 전용 — 창 하나의 수명을 흉내 낸다. */
export function __resetTermLayoutForTests() {
  remembered = { layout: null, active: null };
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

const ARROWS: Record<string, PaneMove> = { ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };

/** ⌥⌘ + 방향키(macOS) · Ctrl+Alt + 방향키(그 밖) → 칸 이동 방향. */
function paneMoveOf(e: KeyboardEvent): PaneMove | null {
  const dir = ARROWS[e.key];
  if (!dir || e.shiftKey) return null;
  const held = isMac() ? e.metaKey && e.altKey && !e.ctrlKey : e.ctrlKey && e.altKey && !e.metaKey;
  return held ? dir : null;
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
  // 터미널 찾기 (⌘F) — 고른 칸 위에 한 줄. 다른 칸을 고르면 닫는다.
  const [finding, setFinding] = useState(false);
  // 한 칸 크게 (Orca 「Expand pane」 ⇧⌘↩) — 트리는 그대로 두고 고른 칸만 그린다.
  const [zoomed, setZoomed] = useState(false);
  const panesRef = useRef<HTMLDivElement | null>(null);
  const opening = useRef(false);
  // 같은 일을 worktree 여럿에서 (Orca 벤치마킹 #worktree-race) — 시작 대화상자. 레인 띠는 RaceStrip.
  const [raceOpen, setRaceOpen] = useState(false);
  useRace(); // 레인 ↔ 세션 짝이 바뀌면 탭 이름(「레인 n」)을 다시 그린다
  // 나누려고 연 세션은 「새 세션이면 고른 칸에」 규칙에서 뺀다 — 고른 칸을 빼앗지 않게.
  const openingSplit = useRef(false);
  const records = useRecordsSince(projectId, workday, sessions);

  const add = useCallback(async () => {
    if (opening.current) return;
    opening.current = true;
    try {
      const id = await openTerm(projectId);
      setView((v) => show(v, id));
    } catch (e) {
      toast.destructive(t("terminal.openFailed", { error: tError(toAppError(e)) }));
    } finally {
      opening.current = false;
    }
  }, [projectId, setView, t]);

  // 처음 열면 셸 하나 — 빈 화면에서 단추부터 찾게 하지 않는다.
  useEffect(() => {
    if (termsSnapshot().length === 0) void add();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // 칸이 하나가 되면 「크게」는 뜻이 없다.
  useEffect(() => {
    if (count < 2) setZoomed(false);
  }, [count]);

  // 고른 칸을 나눈다 — 새 셸은 그 칸의 폴더(레인이면 그 worktree)에서. 칸이 너무 좁으면 나누지 않는다.
  const split = useCallback(
    async (dir: PaneDir) => {
      if (opening.current || active == null) return;
      const pane = panesRef.current?.querySelector<HTMLElement>(`[data-term-id="${active}"]`);
      const room = dir === "row" ? pane?.clientWidth : pane?.clientHeight;
      if (room != null && room > 0 && room < (dir === "row" ? 2 * SPLIT_MIN.row : 2 * SPLIT_MIN.col)) {
        toast.info(t("terminal.splitNoRoom"));
        return;
      }
      opening.current = true;
      openingSplit.current = true;
      try {
        const id = await openTerm(projectId, null, lanePathOf(active));
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
    [active, projectId, setView, t],
  );

  // 탭 · 칸을 고른다 — 칸에 없던 세션이면 고른 칸에 갈아 끼운다.
  const pick = useCallback((id: number) => setView((v) => show(v, id)), [setView]);

  // 고른 칸이 바뀌면 입력도 그리로 — 찾기 줄은 닫는다(다른 세션의 출력이다).
  useEffect(() => {
    setFinding(false);
    if (active != null) focusTerm(active);
  }, [active]);

  // 화면이 서 있는 동안 온 「이 세션을 보여 줘」.
  useEffect(() => onTermFocus(pick), [pick]);

  // 새 세션 ⌘T · 오른쪽으로 나누기 ⌘D · 아래로 ⇧⌘D · 한 칸 크게 ⇧⌘↩ (Orca 기본값).
  // 그 밖 OS 는 셸 키에 Shift 를 하나 더 — Ctrl+Shift+T · Ctrl+Shift+D · Ctrl+Alt+Shift+D · Ctrl+Shift+Enter.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
        setFinding(true);
      } else if (c.key === "enter" && c.shift && countRef.current > 1) {
        e.preventDefault();
        setZoomed((z) => !z);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [add, split, pick]);

  // Finder 에서 끌어다 놓은 파일 · 그림 → 커서 아래 세션의 입력에 따옴표 친 경로.
  const dropOver = useTerminalFileDrop(active, getPlatform() === "windows", pasteToTerm);

  // 다른 화면으로 가면 미리보기도 닫는다 — 돌아왔을 때 크게 띄운 그림이 남아 있지 않게.
  useEffect(() => closePeek, []);

  // 레인의 세션은 「레인 n」 으로 — 셋이 모두 claude 라 이름만으로는 갈리지 않는다.
  const laneLabel = (s: TermInfo) => {
    const n = laneNumberOf(s.id);
    return n != null ? t("race.lane", { n }) : s.label;
  };

  const shown = new Set(leaves(layout));
  // 칸이 둘 이상이면 칸마다 머리 한 줄 — 어느 칸이 어느 세션인지 · 고른 칸이 어디인지.
  const paneHead = (id: number) => {
    const s = count > 1 ? sessions.find((x) => x.id === id) : undefined;
    if (!s) return null;
    const waiting = s.alive && needsMe(s.status);
    return (
      <div className="tm-pane-head">
        <span className={"tm-dot" + (s.alive ? (waiting ? " is-wait" : " is-live") : "")} aria-hidden="true" />
        <span className="tm-name">{laneLabel(s)}</span>
        <span className="tm-meta">{sessionWord(t, s)}</span>
        {zoomed ? <span className="tm-meta">{" · "}{t("terminal.zoomed", { key: kbd("⇧⌘↩", "terminal") })}</span> : null}
        <span className="tm-note-sp" />
        <button
          type="button"
          className="iconbtn sm"
          aria-label={t("terminal.closeAria", { name: s.label })}
          onClick={() => closeTerm(s.id)}
        >
          <X size={11} />
        </button>
      </div>
    );
  };
  const current = sessions.find((s) => s.id === active) ?? null;
  const currentWaiting = current != null && current.alive && needsMe(current.status);
  return (
    <>
      <Toolbar title={t("nav.terminal")}>
        <button type="button" className="btn sm" onClick={() => void add()}>
          <Plus size={13} aria-hidden="true" />
          {t("terminal.new")}
          <kbd className="kbd">{kbd("⌘T", "terminal")}</kbd>
        </button>
        {sessions.length > 0 ? (
          <>
            <button
              type="button"
              className="iconbtn sm"
              aria-label={t("terminal.splitRight")}
              title={`${t("terminal.splitRight")} (${kbd("⌘D", "terminal")})`}
              onClick={() => void split("row")}
            >
              <Columns2 size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="iconbtn sm"
              aria-label={t("terminal.splitDown")}
              title={`${t("terminal.splitDown")} (${kbd("⇧⌘D", "terminal")})`}
              onClick={() => void split("col")}
            >
              <Rows2 size={13} aria-hidden="true" />
            </button>
          </>
        ) : null}
        {count > 1 ? (
          <button
            type="button"
            className="btn sm"
            title={t("terminal.unsplitTitle")}
            onClick={() => setView((v) => (v.active != null ? { layout: leaf(v.active), active: v.active } : v))}
          >
            {t("terminal.unsplit")}
          </button>
        ) : null}
        <button type="button" className="btn sm" title={t("race.buttonTitle")} onClick={() => setRaceOpen(true)}>
          <GitBranchIcon size={13} aria-hidden="true" />
          {t("race.button")}
        </button>
      </Toolbar>
      <div className="tm-split">
        <RaceStrip projectId={projectId} />
        {sessions.length === 0 ? <p className="tm-empty">{t("terminal.empty")}</p> : null}
        {sessions.length > 1 ? (
          // 둘 이상이면 위 탭 줄 — 왼쪽 목록 칸은 일지 · 계획 목록 칸과 두 겹이었다 (화면 검사 #term-col).
          <div className="tm-tabs" role="tablist" aria-label={t("terminal.listAria")}>
            {sessions.map((s) => {
              const n = records.get(s.id) ?? 0;
              const waiting = s.alive && needsMe(s.status);
              return (
                <div
                  key={s.id}
                  className={"tm-tab" + (s.id === active ? " is-active" : shown.has(s.id) ? " is-shown" : "")}
                >
                  <button
                    type="button"
                    role="tab"
                    className="tm-pick"
                    aria-selected={s.id === active}
                    title={waiting && s.status?.msg ? s.status.msg : undefined}
                    onClick={() => pick(s.id)}
                  >
                    <span
                      className={"tm-dot" + (s.alive ? (waiting ? " is-wait" : " is-live") : "")}
                      aria-hidden="true"
                    />
                    <span className="tm-name">{laneLabel(s)}</span>
                    <span className="tm-meta">
                      {sessionWord(t, s)}
                      {n > 0 ? (
                        <span className="tm-rec" title={t("terminal.recordsTitle")}>
                          {" · "}
                          {t("terminal.records", { n })}
                        </span>
                      ) : null}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="iconbtn sm tm-close"
                    aria-label={t("terminal.closeAria", { name: s.label })}
                    onClick={() => closeTerm(s.id)}
                  >
                    <X size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}
        {current && (sessions.length > 1 ? currentWaiting && current.status?.msg : currentWaiting || !current.alive) ? (
          // 세션 하나면 칸이 없다 — 내 손을 기다리거나 끝났을 때만 한 줄 (예외만 보인다).
          <div className={"tm-note" + (currentWaiting ? " is-wait" : "")} role="status">
            <span className="tm-note-word">{sessionWord(t, current)}</span>
            {currentWaiting && current.status?.msg ? <span className="tm-note-msg">{current.status.msg}</span> : null}
            <span className="tm-note-sp" />
            {sessions.length === 1 && !current.alive ? (
              <button type="button" className="btn ghost sm" onClick={() => closeTerm(current.id)}>
                {t("terminal.closeAria", { name: current.label })}
              </button>
            ) : null}
          </div>
        ) : null}
        <div className="tm-panes" ref={panesRef}>
          {layout ? (
            <PaneTree
              node={zoomed && active != null ? leaf(active) : layout}
              active={active}
              dropOver={dropOver}
              dropHint={t("terminal.drop.hint")}
              head={paneHead}
              onActivate={pick}
              onRatio={(path, ratio) => setView((v) => (v.layout ? { ...v, layout: setRatio(v.layout, path, ratio) } : v))}
              onEqualize={() => setView((v) => (v.layout ? { ...v, layout: equalize(v.layout) } : v))}
              separatorLabel={t("terminal.divider")}
              overlay={finding && active != null ? <TermFindBar id={active} onClose={() => setFinding(false)} /> : null}
            />
          ) : null}
        </div>
      </div>
      <TermImagePeekHost />
      <TermFileMenuHost projectRoot={projectRoot} />
      {raceOpen ? <RaceStartDialog projectId={projectId} onClose={() => setRaceOpen(false)} /> : null}
    </>
  );
}
