/**
 * 터미널 세션의 OS 알림 — **예외만** (ocul-next #waiting-alert · #orca-attention, 11-15 넓힘).
 *
 * 알리는 것: 내 손을 기다림(OSC 7501 blocked)에 들어섬 · 오류(error)에 들어섬 · 60초 넘게 일하고 끝냈는데
 * (done · idle) 그 세션 시작 뒤 일지가 0건 · 종(BEL)과 프로그램 알림(OSC 9 · 777). 일지를 남기고 끝낸 것은
 * 평상이라 알리지 않는다(Orca 는 끝날 때마다 울려 시끄러웠다, #4375). 모두 그 창이 앞에 없을 때만 — 앞에
 * 있으면 탭 · 오늘의 줄로 충분하다(Orca 의 알림 규칙). 같은 기다림이 이어지며 한 줄만 바뀌면 다시 울리지
 * 않는다. 종 · 알림은 세션마다 30초에 한 번, 같은 글은 10분에 한 번. 권한은 처음 울릴 때 한 번 묻는다.
 *
 * 제목은 「프로젝트 · 세션 이름」(세션 이름은 프로그램이 붙인 제목, 없으면 셸 이름). 알림을 눌러 창이
 * 앞에 오면(10초 안) 그 세션을 고른다 — 「어느 세션이었지」를 사람이 찾지 않게(`requestTermFocus`).
 */
import { useEffect } from "react";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

import { hooksApi } from "@/api/claudeSurface";
import { oculpmApi } from "@/api/oculpm";
import type { TermEvent, TermInfo, TermStatus } from "@/api/terminal";
import type { ClaudeQuestion, ClaudeWaiting } from "@/lib/bindings";
import { t } from "@/i18n";
import { requestTermFocus } from "./focusRequest";
import { needsMe, sessionWord } from "./status";

/** 이만큼 넘게 일하고 끝냈을 때만 「일지 없이 끝냄」 을 센다 — 짧은 문답은 일지가 없어도 평상이다. */
export const WORKED_MS = 60_000;
/** 종 · 프로그램 알림은 세션마다 이 간격에 한 번 — 그 세션의 다른 알림 뒤에도(기다림과 종이 겹친다). */
export const SIGNAL_GAP_MS = 30_000;
/** 같은 글의 종 · 프로그램 알림은 이 동안 한 번. */
export const SAME_TEXT_MS = 10 * 60_000;
/** 알림 뒤 이 안에 창이 앞에 오면 알림을 누른 것으로 보고 그 세션을 고른다. */
export const LANDING_MS = 10_000;

let permission: Promise<boolean> | null = null;
let projectName = "";
/** 세션마다 마지막으로 알린 때 — 종 · 알림의 간격을 잰다. */
const lastAlertAt = new Map<number, number>();
/** 세션마다 마지막 종 · 알림의 글 — 같은 글을 거른다. */
const lastSignal = new Map<number, { text: string; at: number }>();
/** 마지막 알림 — 창이 앞에 오면 그 세션으로 간다. */
let landing: { sessionId: number; at: number } | null = null;
let landingWatched = false;

/** 이 창의 프로젝트 이름 — 알림 제목에 싣는다(창 하나 = 프로젝트 하나). */
export function setAlertProjectName(name: string | null): void {
  projectName = name ?? "";
}

function allowed(): Promise<boolean> {
  permission ??= (async () => {
    if (await isPermissionGranted()) return true;
    return (await requestPermission()) === "granted";
  })().catch(() => false);
  return permission;
}

/** 60초 넘게 일하다 끝냈다(working → done · idle) — 이 세션의 일지를 세어 볼 차례. */
export function finishedLong(prev: TermStatus | null, next: TermStatus | null): boolean {
  if (prev?.state !== "working" || (next?.state !== "done" && next?.state !== "idle")) return false;
  return Date.parse(next.since) - Date.parse(prev.since) >= WORKED_MS;
}

/**
 * 이 상태 변화가 알림감인가 — 모두 창이 앞에 없을 때만. 기다림 · 오류로 막 들어섰거나, 60초 넘게 일하고
 * 끝냈는데 그 세션 시작 뒤 일지가 0건(`records`, 모르면 `null` — 알리지 않는다).
 */
export function shouldAlert(
  prev: TermStatus | null,
  next: TermStatus | null,
  windowFocused: boolean,
  records: number | null = null,
): boolean {
  if (windowFocused) return false;
  if (needsMe(next) && !needsMe(prev)) return true;
  if (next?.state === "error" && prev?.state !== "error") return true;
  return finishedLong(prev, next) && records === 0;
}

/** 종 · 프로그램 알림이 알림감인가 — 세션마다 30초에 한 번(다른 알림 뒤에도), 같은 글은 10분에 한 번. */
export function shouldSignal(id: number, text: string, now: number, windowFocused: boolean): boolean {
  if (windowFocused) return false;
  const last = lastAlertAt.get(id);
  if (last !== undefined && now - last < SIGNAL_GAP_MS) return false;
  const same = lastSignal.get(id);
  return !(same && same.text === text && now - same.at < SAME_TEXT_MS);
}

/** 그 세션이 시작된 뒤 이 프로젝트에 남은 일지 수 — 오늘(날은 백엔드가 정한다)의 일지에서. 못 세면 `null`. */
async function recordsSince(info: TermInfo): Promise<number | null> {
  try {
    const { current_workday } = await oculpmApi.getStatus(info.project_id);
    const list = await oculpmApi.listJournalEntries(info.project_id, current_workday);
    const start = Date.parse(info.started_at);
    return list.filter((e) => Date.parse(e.created_at) >= start).length;
  } catch {
    return null;
  }
}

/** 알림을 누르면 macOS 는 앱을 앞으로 가져온다 — 그 뒤 창이 앞에 오면 마지막 알림의 세션을 고른다. */
function watchLanding(): void {
  if (landingWatched || typeof window === "undefined") return;
  landingWatched = true;
  window.addEventListener("focus", () => {
    const last = landing;
    landing = null;
    if (last && Date.now() - last.at <= LANDING_MS) requestTermFocus(last.sessionId);
  });
}

/** 「프로젝트 · 세션 이름」 으로 OS 알림을 띄운다. 실패는 조용히 버린다(화면 표시가 남는다). */
function notifySession(info: TermInfo, body: string): void {
  const title = [projectName, info.title || info.label].filter(Boolean).join(" · ");
  lastAlertAt.set(info.id, Date.now());
  watchLanding();
  void allowed()
    .then((ok) => {
      if (!ok) return;
      sendNotification({ title, body });
      landing = { sessionId: info.id, at: Date.now() };
    })
    .catch(() => {});
}

/** 세션 상태가 바뀌었다 — 알림감이면 OS 알림을 띄운다(일지 없이 끝냄은 일지를 센 뒤에). */
export function alertIfWaiting(prev: TermStatus | null, info: TermInfo): void {
  const next = info.status;
  if (document.hasFocus()) return;
  if (finishedLong(prev, next)) {
    void recordsSince(info).then((records) => {
      if (shouldAlert(prev, next, document.hasFocus(), records)) notifySession(info, t("terminal.notify.noRecord"));
    });
    return;
  }
  if (!shouldAlert(prev, next, false)) return;
  notifySession(info, next?.msg || sessionWord(t, info));
}

/** 종(BEL) · 프로그램 알림(OSC 9 · 777)이 왔다 — 알림감이면 OS 알림을 띄운다. */
export function alertOnSignal(info: TermInfo, ev: Extract<TermEvent, { kind: "bell" | "notice" }>): void {
  const body = ev.kind === "bell" ? t("terminal.notify.bell") : [ev.title, ev.body].filter(Boolean).join(" · ");
  const now = Date.now();
  if (!shouldSignal(info.id, body, now, document.hasFocus())) return;
  lastSignal.set(info.id, { text: body, at: now });
  notifySession(info, body);
}

/** 세션을 닫았다 — 그 세션의 알림 기록을 버린다. */
export function forgetAlerts(id: number): void {
  lastAlertAt.delete(id);
  lastSignal.delete(id);
  if (landing?.sessionId === id) landing = null;
}

/** 처음 보는 질문만 (MCP ask_user) — id 가 같으면 이미 알린 것이다. */
export function newQuestions(seen: Set<string>, list: readonly ClaudeQuestion[]): ClaudeQuestion[] {
  const fresh = list.filter((q) => !seen.has(q.id));
  for (const q of list) seen.add(q.id);
  return fresh;
}

/** 처음 보는 바깥 터미널 기다림만 — `세션 · 시작 시각` 이 같으면 이미 알린 것이다. */
export function newWaitings(seen: Set<string>, list: readonly ClaudeWaiting[]): ClaudeWaiting[] {
  const fresh = list.filter((w) => !seen.has(`${w.session_id}@${w.since}`));
  for (const w of list) seen.add(`${w.session_id}@${w.since}`);
  return fresh;
}

/**
 * 바깥 터미널의 Claude 기다림(플러그인 Notification 훅, #notify-hook)도 창이 뒤에 있을 때만 OS 알림으로.
 * 프로젝트 창마다 하나 — 처음 읽은 것은 알리지 않는다(앱을 켜기 전부터 있던 기다림).
 */
export function useHookWaitingAlerts(projectId: number): void {
  useEffect(() => {
    let alive = true;
    const seen = new Set<string>();
    void hooksApi
      .waiting(projectId)
      .then((list) => alive && newWaitings(seen, list))
      .catch(() => {});
    const off = hooksApi.onWaitingChanged((pid) => {
      if (pid !== projectId) return;
      void hooksApi
        .waiting(projectId)
        .then((list) => {
          if (!alive) return;
          const fresh = newWaitings(seen, list);
          if (fresh.length === 0 || document.hasFocus()) return;
          const w = fresh[0];
          const word = w.kind === "permission" ? t("terminal.state.permission") : t("terminal.state.idle");
          void allowed().then((ok) => {
            if (!ok) return;
            sendNotification({
              title: projectName ? t("terminal.notify.titleIn", { project: projectName }) : t("terminal.notify.title"),
              body: [t("today.check.outsideTerminal"), w.message || word].join(" · "),
            });
          });
        })
        .catch(() => {});
    });
    // Claude 가 앱에 물었다 (MCP ask_user) — 창이 뒤면 그 질문을 알린다.
    const asked = new Set<string>();
    void hooksApi
      .questions(projectId)
      .then((list) => alive && newQuestions(asked, list))
      .catch(() => {});
    const offQ = hooksApi.onQuestionsChanged((pid) => {
      if (pid !== projectId) return;
      void hooksApi
        .questions(projectId)
        .then((list) => {
          if (!alive) return;
          const fresh = newQuestions(asked, list);
          if (fresh.length === 0 || document.hasFocus()) return;
          void allowed().then((ok) => {
            if (!ok) return;
            sendNotification({
              title: projectName
                ? `${projectName} · ${t("today.check.kind.question")}`
                : t("today.check.kind.question"),
              body: fresh[0].question,
            });
          });
        })
        .catch(() => {});
    });
    return () => {
      alive = false;
      void off.then((fn) => fn());
      void offQ.then((fn) => fn());
    };
  }, [projectId]);
}
