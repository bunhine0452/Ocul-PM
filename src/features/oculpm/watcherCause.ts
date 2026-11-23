/**
 * 실시간 갱신(워처)이 왜 꺼졌는가 — 실제 원인별로 (love-round #watcher-offline-cause, 11-23).
 *
 * 예전에는 원인과 상관없이 「다른 Ocul 창이 이 프로젝트를 감시하고 있어요」 와 [이 창에서 감시하기] 가 떴다.
 * 잠금 충돌 말고도 macOS 의 데스크탑 · 문서 폴더 접근 거부(EPERM), Linux 의 inotify 감시 한도(ENOSPC → notify 가
 * 「OS file watch limit reached.」 로 바꾼다), 옮기거나 지운 폴더가 있다. 그때는 가져오기 단추가 소용없고 1분마다
 * 다시 해도 영영 실패해, 일지가 안 오는 이유를 알 수 없었다.
 *
 * 판정 재료는 백엔드의 오류 봉투 그대로다: 잠금은 `invalid_config` + 「lock held by another instance」
 * (`manager/lifecycle.rs` 의 `LockAcquisition::Held`), 나머지는 `io` + notify 의 영어 원문
 * (`watcher/mod.rs` 의 「notify watch: …」). 마지막 원인은 설정의 「일지가 안 와요」 진단이 읽도록 남겨 둔다.
 */
import type { AppError } from "@/lib/bindings";
import { createStore } from "@/lib/createStore";

export type WatcherCause = "lock" | "watchLimit" | "permission" | "missing" | "other";

const WATCH_LIMIT = /file watch limit|No space left on device|os error 28\b|inotify/i;
const PERMISSION = /Operation not permitted|Permission denied|os error (1|13)\b|Access is denied|os error 5\b/i;
const MISSING = /No path was found|No such file or directory|os error 2\b|cannot find the path|os error 3\b/i;

export function watcherCause(err: AppError): WatcherCause {
  const detail = err.detail ?? "";
  if (/lock held by another instance/i.test(detail)) return "lock";
  if (WATCH_LIMIT.test(detail)) return "watchLimit";
  if (PERMISSION.test(detail)) return "permission";
  if (MISSING.test(detail)) return "missing";
  return "other";
}

/** Linux 의 inotify 한도를 올리는 줄 — 복사만 한다(앱은 돌리지 않는다). */
export const INOTIFY_RAISE =
  "echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf && sudo sysctl -p";

export interface WatcherFailure {
  cause: WatcherCause;
  detail: string | null;
  at: number;
}

const failures = createStore<ReadonlyMap<number, WatcherFailure>>(new Map());

/** 이 창이 감시를 시작하지 못했다 — 원인을 남긴다. `null` 이면 지운다(시작했다 · 가져왔다). */
export function noteWatcherFailure(projectId: number, failure: WatcherFailure | null): void {
  failures.update((prev) => {
    if (!failure && !prev.has(projectId)) return prev;
    const next = new Map(prev);
    if (failure) next.set(projectId, failure);
    else next.delete(projectId);
    return next;
  });
}

export function useWatcherFailure(projectId: number | null): WatcherFailure | null {
  const all = failures.useValue();
  return projectId == null ? null : (all.get(projectId) ?? null);
}
