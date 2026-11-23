// 실시간 갱신이 꺼진 이유를 실제 원인별로 말한다 (love-round #watcher-offline-cause, 11-23).
// 예전에는 원인과 상관없이 「다른 Ocul 창이 감시 중」 + [이 창에서 감시하기] 였다 — 권한 · inotify 한도에서 그 단추는
// 같은 이유로 실패했다. 재료는 백엔드 오류 봉투의 원문(`lifecycle.rs` 잠금 · `watcher/mod.rs` 의 notify 원문).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));

import { t } from "@/i18n";
import { __setPlatformForTests } from "@/lib/platform";
import { dismissToast, getToasts } from "@/lib/toast";
import { noteWatcherFailure, watcherCause } from "@/features/oculpm/watcherCause";
import { announceWatcherOffline } from "@/features/oculpm/watcherToast";
import { useWatcherFailure } from "@/features/oculpm/watcherCause";
import { renderHook } from "@testing-library/react";

const LOCK = { code: "invalid_config", detail: "invalid config: read-only mode: lock held by another instance (pid 41)" };
const LIMIT = { code: "io", detail: "io error at /p: notify watch: OS file watch limit reached. about [\"/p\"]" };
const ENOSPC = { code: "io", detail: "io error at /p: notify watch: No space left on device (os error 28)" };
const EPERM = { code: "io", detail: "io error at /Users/me/Desktop/p: notify watch: Operation not permitted (os error 1)" };
const GONE = { code: "io", detail: "io error at /p: notify watch: No path was found. about [\"/p\"]" };
const ODD = { code: "io", detail: "io error at /p: notify init: something new" };

beforeEach(() => {
  for (const toast of getToasts()) dismissToast(toast.id);
  noteWatcherFailure(7, null);
});
afterEach(() => __setPlatformForTests(null));

describe("watcherCause", () => {
  it.each([
    [LOCK, "lock"],
    [LIMIT, "watchLimit"],
    [ENOSPC, "watchLimit"],
    [EPERM, "permission"],
    [{ code: "io", detail: "Permission denied (os error 13)" }, "permission"],
    [GONE, "missing"],
    [ODD, "other"],
    [{ code: "io", detail: null }, "other"],
  ] as const)("%o → %s", (err, cause) => {
    expect(watcherCause(err)).toBe(cause);
  });

  it("does not read os error 28 as error 2 (no such file)", () => {
    expect(watcherCause({ code: "io", detail: "x (os error 28)" })).toBe("watchLimit");
  });
});

describe("announceWatcherOffline", () => {
  it("offers take-over only when another window holds the lock", () => {
    // 같은 프로젝트는 토스트가 접힌다(dedupKey) — 시험마다 다른 id.
    announceWatcherOffline(11, LOCK, t);
    const [toast] = getToasts();
    expect(toast.message).toBe(t("watcher.offline"));
    expect(toast.actions?.map((a) => a.label)).toEqual([t("watcher.takeOver")]);
  });

  it("an inotify limit says so on Linux, with a copy action and no take-over", () => {
    __setPlatformForTests("linux");
    announceWatcherOffline(12, ENOSPC, t);
    const [toast] = getToasts();
    expect(toast.message).toBe(t("watcher.cause.watchLimit"));
    expect(toast.message).not.toBe(t("watcher.offline"));
    expect(toast.actions?.map((a) => a.label)).toEqual([t("watcher.cause.copyRaise")]);
  });

  it("a permission denial names the OS setting and offers no take-over", () => {
    __setPlatformForTests("mac");
    announceWatcherOffline(13, EPERM, t);
    const [toast] = getToasts();
    expect(toast.message).toBe(t("watcher.cause.permission"));
    expect(toast.actions ?? []).toEqual([]);
  });

  it("an unknown failure carries the raw cause and a log-folder action", () => {
    announceWatcherOffline(14, ODD, t);
    const [toast] = getToasts();
    expect(toast.message).toContain("something new");
    expect(toast.actions?.map((a) => a.label)).toEqual([t("prefs.data.logs")]);
  });

  it("remembers the cause for the settings diagnosis, and forgets it once watching starts", () => {
    const { result, rerender } = renderHook(() => useWatcherFailure(7));
    expect(result.current).toBeNull();
    announceWatcherOffline(7, GONE, t);
    rerender();
    expect(result.current?.cause).toBe("missing");
    noteWatcherFailure(7, null);
    rerender();
    expect(result.current).toBeNull();
  });
});
