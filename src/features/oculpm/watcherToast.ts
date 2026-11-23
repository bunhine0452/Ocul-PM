/**
 * 「실시간 갱신이 꺼져 있어요」 토스트 — 원인(`watcherCause`)마다 문장과 할 일이 다르다.
 *
 * - 잠금: 다른 창이 감시 중 → [이 창에서 감시하기] (예전 그대로).
 * - 감시 한도(Linux inotify): 한도를 올리는 줄 복사 — 앱은 그 줄을 돌리지 않는다.
 * - 권한: OS 설정의 자리를 말한다(맥은 「파일 및 폴더」).
 * - 폴더 없음: 옮겼거나 지웠다.
 * - 그 밖: 원문 코드 + [로그 폴더].
 *
 * 가져오기 단추는 잠금일 때만 — 권한 · 한도 문제에서 그 단추는 눌러도 같은 이유로 실패했다.
 */
import { revealItemInDir } from "@tauri-apps/plugin-opener";

import { appDataApi } from "@/api/settings";
import { toAppError } from "@/api/invoke";
import { oculpmApi } from "@/api/oculpm";
import type { I18nKey } from "@/i18n";
import { tError } from "@/i18n/errors";
import { getPlatform } from "@/lib/platform";
import { toast, type ToastAction } from "@/lib/toast";
import { INOTIFY_RAISE, noteWatcherFailure, watcherCause, type WatcherCause } from "./watcherCause";

type T = (key: I18nKey, vars?: Record<string, string | number>) => string;

export const WATCHER_CAUSE_KEY: Record<WatcherCause, I18nKey> = {
  lock: "watcher.offline",
  watchLimit: "watcher.cause.watchLimit",
  permission: "watcher.cause.permission",
  missing: "watcher.cause.missing",
  other: "watcher.cause.other",
};

function actionsFor(cause: WatcherCause, projectId: number, t: T): ToastAction[] {
  if (cause === "lock")
    return [
      {
        label: t("watcher.takeOver"),
        onClick: () => {
          void (async () => {
            try {
              await oculpmApi.watcherTakeOver(projectId);
              noteWatcherFailure(projectId, null);
              toast.info(t("watcher.tookOver"));
            } catch (e) {
              toast.destructive(t("watcher.takeOverFailed", { error: tError(toAppError(e)) }));
            }
          })();
        },
      },
    ];
  if (cause === "watchLimit" && getPlatform() === "linux")
    return [
      {
        label: t("watcher.cause.copyRaise"),
        onClick: () => {
          navigator.clipboard.writeText(INOTIFY_RAISE).then(
            () => toast.info(t("common.copied")),
            () => toast.warning(t("op.copyFailed")),
          );
        },
      },
    ];
  if (cause === "other")
    return [
      {
        label: t("prefs.data.logs"),
        onClick: () => {
          void (async () => {
            try {
              const dir = await appDataApi.logDir();
              if (dir) await revealItemInDir(dir);
              else toast.warning(t("prefs.data.noLogs"));
            } catch (e) {
              toast.destructive(tError(toAppError(e)));
            }
          })();
        },
      },
    ];
  return [];
}

/** 감시 시작이 실패했다 — 원인을 남기고(설정 진단이 읽는다) 그 원인의 토스트를 띄운다. */
export function announceWatcherOffline(projectId: number, failure: unknown, t: T): WatcherCause {
  const err = toAppError(failure);
  const cause = watcherCause(err);
  noteWatcherFailure(projectId, { cause, detail: err.detail ?? null, at: Date.now() });
  const body = t(WATCHER_CAUSE_KEY[cause], { error: tError(err) });
  toast.warning(body, {
    title: t("watcher.offlineTitle"),
    dedupKey: `watcher-offline-${projectId}`,
    // 누를 단추가 있으면 사람이 판단할 때까지 둔다.
    durationMs: cause === "lock" || cause === "other" ? 0 : 20000,
    actions: actionsFor(cause, projectId, t),
  });
  return cause;
}
