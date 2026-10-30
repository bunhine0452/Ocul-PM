/**
 * 터미널 (4.0 다시, 플랜 `terminal-v4-20261029`) — 왼쪽 세션 목록 한 칸 + 터미널.
 *
 * 다른 화면과 같은 꼴이다(작업 일지 · 계획 · 변경 = 목록 한 칸 + 본문). 세션 줄은 이름 ·
 * 도는 중/끝남 · **시작 뒤 일지 수** — 터미널에서 돈 일이 기록으로 남았는지 한눈에 본다.
 * 세션은 앱 안에 살고(`termStore`), 화면을 오가도 계속 돈다. 처음 열면 셸 하나를 띄운다.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { toAppError } from "@/api/invoke";
import { oculpmApi } from "@/api/oculpm";
import { projectsApi } from "@/api/projects";
import { Columns2, GitBranchIcon, Plus, X } from "@/components/Icons";
import { Toolbar } from "@/components/Toolbar";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import type { TermInfo } from "@/api/terminal";
import { kbd } from "@/lib/kbd";
import { getPlatform, isMac } from "@/lib/platform";
import { toast } from "@/lib/toast";
import { closeTerm, mountTerm, openTerm, pasteToTerm, subscribeTerms, termsSnapshot } from "./termStore";
import { useTerminalFileDrop } from "./dropFiles";
import { laneNumberOf, useRace } from "./race";
import { RaceStartDialog, RaceStrip } from "./RacePanel";
import { onTermFocus, takeTermFocus } from "./focusRequest";
import { closePeek } from "./imagePeek";
import { TermImagePeekHost } from "./TermImagePeek";
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

/** 나란히 보기의 오른쪽 세션 — 화면을 오가도 기억한다(창 하나에 하나, 모듈 범위). */
let rememberedSplit: number | null = null;

export function TerminalScreen({ projectId, workday }: { projectId: number; workday: string | null }) {
  const { t } = useT();
  const sessions = useSyncExternalStore(subscribeTerms, termsSnapshot);
  // 오늘의 「Claude 가 기다려요」 줄에서 왔으면 그 세션부터.
  const [active, setActive] = useState<number | null>(() => takeTermFocus() ?? sessions[sessions.length - 1]?.id ?? null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const opening = useRef(false);
  // 나란히 보기 (Orca 벤치마킹 #term-split) — 왼쪽은 고른 세션, 오른쪽은 이 세션. 칸은 반반.
  const [split, setSplitState] = useState<number | null>(() => rememberedSplit);
  const setSplit = useCallback((id: number | null) => {
    rememberedSplit = id;
    setSplitState(id);
  }, []);
  const splitRef = useRef<HTMLDivElement | null>(null);
  // 같은 일을 worktree 여럿에서 (Orca 벤치마킹 #worktree-race) — 시작 대화상자. 레인 띠는 RaceStrip.
  const [raceOpen, setRaceOpen] = useState(false);
  useRace(); // 레인 ↔ 세션 짝이 바뀌면 탭 이름(「레인 n」)을 다시 그린다
  // 나란히 칸에 쓰려고 연 세션은 「새 세션이면 고른다」 규칙에서 뺀다 — 왼쪽을 빼앗지 않게.
  const openingSplit = useRef(false);
  const records = useRecordsSince(projectId, workday, sessions);

  const add = useCallback(async () => {
    if (opening.current) return;
    opening.current = true;
    try {
      setActive(await openTerm(projectId));
    } catch (e) {
      toast.destructive(t("terminal.openFailed", { error: tError(toAppError(e)) }));
    } finally {
      opening.current = false;
    }
  }, [projectId, t]);

  // 처음 열면 셸 하나 — 빈 화면에서 단추부터 찾게 하지 않는다.
  useEffect(() => {
    if (termsSnapshot().length === 0) void add();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 고른 세션이 사라졌거나(닫힘) 새 세션이 생기면(「다음」 실행) 마지막 것을 고른다.
  const lastId = sessions[sessions.length - 1]?.id ?? null;
  const prevLast = useRef(lastId);
  useEffect(() => {
    const grew = lastId !== prevLast.current;
    prevLast.current = lastId;
    if (grew && openingSplit.current) {
      openingSplit.current = false;
      return;
    }
    if (grew || (active != null && !sessions.some((s) => s.id === active))) setActive(lastId);
  }, [lastId, active, sessions]);

  // 오른쪽 세션이 닫혔거나 왼쪽으로 옮겨 갔으면 나란히를 접는다.
  useEffect(() => {
    if (split != null && (split === active || !sessions.some((s) => s.id === split))) setSplit(null);
  }, [split, active, sessions, setSplit]);

  // 켜면 다른 세션(가장 최근)을 오른쪽에, 없으면 새 셸을. 끄면 오른쪽 세션은 그대로 돈다(탭에 남는다).
  const toggleSplit = useCallback(async () => {
    if (split != null) return setSplit(null);
    const other = [...termsSnapshot()].reverse().find((s) => s.id !== active && s.alive);
    if (other) return setSplit(other.id);
    if (opening.current) return;
    opening.current = true;
    openingSplit.current = true;
    try {
      setSplit(await openTerm(projectId));
    } catch (e) {
      openingSplit.current = false;
      toast.destructive(t("terminal.openFailed", { error: tError(toAppError(e)) }));
    } finally {
      opening.current = false;
    }
  }, [split, active, projectId, setSplit, t]);

  // 탭을 고른다 — 오른쪽에 있던 세션이면 두 칸을 바꾼다.
  const pick = (id: number) => {
    if (id === split) setSplit(active);
    setActive(id);
  };

  useEffect(() => {
    if (active == null || !paneRef.current) return;
    return mountTerm(active, paneRef.current);
  }, [active]);

  useEffect(() => {
    if (split == null || !splitRef.current) return;
    return mountTerm(split, splitRef.current);
  }, [split]);

  // 화면이 서 있는 동안 온 「이 세션을 보여 줘」.
  useEffect(() => onTermFocus(setActive), []);

  // 새 세션 — macOS ⌘T, 그 밖 Ctrl+Shift+T (Ctrl+T 는 셸의 글자 바꾸기라 비워 둔다).
  // 나란히 — macOS ⌘\, 그 밖 Ctrl+Shift+\ (Ctrl+\ 는 셸의 종료 신호 SIGQUIT 다).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const hit = isMac() ? e.metaKey && !e.shiftKey : e.ctrlKey && e.shiftKey;
      if (!hit) return;
      if (e.code === "Backslash") {
        e.preventDefault();
        void toggleSplit();
      } else if (e.key.toLowerCase() === "t") {
        e.preventDefault();
        void add();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [add, toggleSplit]);

  // Finder 에서 끌어다 놓은 파일 · 그림 → 커서 아래 세션의 입력에 따옴표 친 경로.
  const dropOver = useTerminalFileDrop(active, getPlatform() === "windows", pasteToTerm);

  const shortcut = isMac() ? kbd("⌘T") : kbd("⌘⇧T");
  const splitKey = isMac() ? kbd("⌘\\") : kbd("⌘⇧\\");
  // 다른 화면으로 가면 미리보기도 닫는다 — 돌아왔을 때 크게 띄운 그림이 남아 있지 않게.
  useEffect(() => closePeek, []);

  // 레인의 세션은 「레인 n」 으로 — 셋이 모두 claude 라 이름만으로는 갈리지 않는다.
  const laneLabel = (s: TermInfo) => {
    const n = laneNumberOf(s.id);
    return n != null ? t("race.lane", { n }) : s.label;
  };

  const current = sessions.find((s) => s.id === active) ?? null;
  const currentWaiting = current != null && current.alive && needsMe(current.status);
  return (
    <>
      <Toolbar title={t("nav.terminal")}>
        <button type="button" className="btn sm" onClick={() => void add()}>
          <Plus size={13} aria-hidden="true" />
          {t("terminal.new")}
          <kbd className="kbd">{shortcut}</kbd>
        </button>
        {sessions.length > 0 ? (
          <button
            type="button"
            className="btn sm"
            aria-pressed={split != null}
            title={t("terminal.splitTitle")}
            onClick={() => void toggleSplit()}
          >
            <Columns2 size={13} aria-hidden="true" />
            {split != null ? t("terminal.unsplit") : t("terminal.split")}
            <kbd className="kbd">{splitKey}</kbd>
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
                  className={"tm-tab" + (s.id === active ? " is-active" : s.id === split ? " is-split" : "")}
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
        {/* 왼쪽 칸은 늘 같은 요소다 — 나란히를 켜고 꺼도 다시 만들어지면 붙어 있던 터미널이 떨어진다. */}
        <div className={"tm-panes" + (split != null ? " is-split" : "")}>
          <div
            className={"tm-pane" + (dropOver != null && dropOver === active ? " is-drop" : "")}
            ref={paneRef}
            data-term-id={active ?? undefined}
            data-drop-hint={t("terminal.drop.hint")}
          />
          {split != null ? (
            <div
              className={"tm-pane" + (dropOver === split ? " is-drop" : "")}
              ref={splitRef}
              data-term-id={split}
              data-drop-hint={t("terminal.drop.hint")}
            />
          ) : null}
        </div>
      </div>
      <TermImagePeekHost />
      {raceOpen ? <RaceStartDialog projectId={projectId} onClose={() => setRaceOpen(false)} /> : null}
    </>
  );
}
