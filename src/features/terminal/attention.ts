/**
 * 「Claude 가 기다려요」 OS 알림 (ocul-next #waiting-alert · #orca-attention).
 *
 * 세션 안 프로그램이 내 손을 기다리는 상태(OSC 7501 blocked)로 **들어설 때** 한 번, 그 창이
 * 앞에 없을 때만 보낸다 — 앞에 있으면 터미널 목록 · 오늘의 줄로 충분하다(Orca 의 알림 규칙).
 * 같은 기다림이 이어지며 한 줄만 바뀌면 다시 울리지 않는다. 권한은 처음 울릴 때 한 번 묻는다.
 */
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";

import type { TermInfo, TermStatus } from "@/api/terminal";
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
