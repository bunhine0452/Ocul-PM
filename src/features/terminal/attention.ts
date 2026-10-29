/**
 * 「Claude 가 기다려요」 OS 알림 (ocul-next #waiting-alert · #orca-attention).
 *
 * 세션 안 프로그램이 내 손을 기다리는 상태(OSC 7501 blocked)로 **들어설 때** 한 번, 그 창이
 * 앞에 없을 때만 보낸다 — 앞에 있으면 터미널 목록 · 오늘의 줄로 충분하다(Orca 의 알림 규칙).
 * 같은 기다림이 이어지며 한 줄만 바뀌면 다시 울리지 않는다. 권한은 처음 울릴 때 한 번 묻는다.
 */
import { useEffect } from "react";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

import { hooksApi } from "@/api/claudeSurface";
import type { TermInfo, TermStatus } from "@/api/terminal";
import type { ClaudeWaiting } from "@/lib/bindings";
import { t } from "@/i18n";
import { needsMe, sessionWord } from "./status";

let permission: Promise<boolean> | null = null;
let projectName = "";

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

/** 이 상태 변화가 알림감인가 — 기다림으로 막 들어섰고, 창이 앞에 없다. */
export function shouldAlert(prev: TermStatus | null, next: TermStatus | null, windowFocused: boolean): boolean {
  return !windowFocused && needsMe(next) && !needsMe(prev);
}

/** 세션 상태가 바뀌었다 — 알림감이면 OS 알림을 띄운다. 실패는 조용히 버린다(화면 표시가 남는다). */
export function alertIfWaiting(prev: TermStatus | null, info: TermInfo): void {
  if (!shouldAlert(prev, info.status, document.hasFocus())) return;
  const body = [info.label, info.status?.msg || sessionWord(t, info)].filter(Boolean).join(" · ");
  void allowed()
    .then((ok) => {
      if (ok) sendNotification({
          title: projectName ? t("terminal.notify.titleIn", { project: projectName }) : t("terminal.notify.title"),
          body,
        });
    })
    .catch(() => {});
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
    return () => {
      alive = false;
      void off.then((fn) => fn());
    };
  }, [projectId]);
}
