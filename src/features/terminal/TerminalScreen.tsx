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
import { Plus, X } from "@/components/Icons";
import { Toolbar } from "@/components/Toolbar";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import type { TermInfo } from "@/api/terminal";
import { kbd } from "@/lib/kbd";
import { isMac } from "@/lib/platform";
import { toast } from "@/lib/toast";
import { closeTerm, mountTerm, openTerm, subscribeTerms, termsSnapshot } from "./termStore";
import { onTermFocus, takeTermFocus } from "./focusRequest";
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

export function TerminalScreen({ projectId, workday }: { projectId: number; workday: string | null }) {
  const { t } = useT();
  const sessions = useSyncExternalStore(subscribeTerms, termsSnapshot);
  // 오늘의 「Claude 가 기다려요」 줄에서 왔으면 그 세션부터.
  const [active, setActive] = useState<number | null>(() => takeTermFocus() ?? sessions[sessions.length - 1]?.id ?? null);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const opening = useRef(false);
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
    if (lastId !== prevLast.current || (active != null && !sessions.some((s) => s.id === active))) setActive(lastId);
    prevLast.current = lastId;
  }, [lastId, active, sessions]);

  useEffect(() => {
    if (active == null || !paneRef.current) return;
    return mountTerm(active, paneRef.current);
  }, [active]);

  // 화면이 서 있는 동안 온 「이 세션을 보여 줘」.
  useEffect(() => onTermFocus(setActive), []);

  // 새 세션 — macOS ⌘T, 그 밖 Ctrl+Shift+T (Ctrl+T 는 셸의 글자 바꾸기라 비워 둔다).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const hit = isMac() ? e.metaKey && !e.shiftKey : e.ctrlKey && e.shiftKey;
      if (!hit || e.key.toLowerCase() !== "t") return;
      e.preventDefault();
      void add();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [add]);

  const shortcut = isMac() ? kbd("⌘T") : kbd("⌘⇧T");
  return (
    <>
      <Toolbar title={t("nav.terminal")}>
        <button type="button" className="btn sm" onClick={() => void add()}>
          <Plus size={13} aria-hidden="true" />
          {t("terminal.new")}
          <kbd className="kbd">{shortcut}</kbd>
        </button>
      </Toolbar>
      <div className="tm-split">
        <div className="tm-col" role="region" aria-label={t("terminal.listAria")}>
          {sessions.length === 0 ? <p className="tm-empty">{t("terminal.empty")}</p> : null}
          <ul className="tm-list">
            {sessions.map((s) => {
              const n = records.get(s.id) ?? 0;
              const waiting = s.alive && needsMe(s.status);
              return (
                <li key={s.id} className={"tm-item" + (s.id === active ? " is-active" : "")}>
                  <button
                    type="button"
                    className="tm-pick"
                    aria-current={s.id === active ? "true" : undefined}
                    onClick={() => setActive(s.id)}
                  >
                    <span
                      className={"tm-dot" + (s.alive ? (waiting ? " is-wait" : " is-live") : "")}
                      aria-hidden="true"
                    />
                    <span className="tm-name">{s.label}</span>
                    <span className="tm-meta">
                      {sessionWord(t, s)}
                      {n > 0 ? (
                        <span className="tm-rec" title={t("terminal.recordsTitle")}>
                          {" · "}
                          {t("terminal.records", { n })}
                        </span>
                      ) : null}
                    </span>
                    {waiting && s.status?.msg ? <span className="tm-msg">{s.status.msg}</span> : null}
                  </button>
                  <button
                    type="button"
                    className="iconbtn sm tm-close"
                    aria-label={t("terminal.closeAria", { name: s.label })}
                    onClick={() => closeTerm(s.id)}
                  >
                    <X size={13} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="tm-pane" ref={paneRef} />
      </div>
    </>
  );
}
