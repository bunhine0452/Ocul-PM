// 코드 화면의 파일 트리가 **스스로** 최신이 되는 계약 (#tree-auto-refresh).
//
// 이전에는 밖에 있는 에이전트가 파일을 만들어도 트리는 마운트 때 읽은 목록에
// 머물렀고, ⟳ 를 눌러야만 나타났다. 워처 이벤트를 트리에 붙여 그 손질을 없앤다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

type Handler = (e: { payload: unknown }) => void;

const handlers = new Map<string, Handler[]>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (name: string, cb: Handler) => {
    handlers.set(name, [...(handlers.get(name) ?? []), cb]);
    return Promise.resolve(() => {
      handlers.set(name, (handlers.get(name) ?? []).filter((h) => h !== cb));
    });
  },
  once: () => Promise.resolve(() => {}),
  emit: () => Promise.resolve(),
  TauriEvent: {},
}));

const { useTreeWatch, isTreeShapingOp } = await import("@/features/code/useTreeWatch");
const { nearestCachedDir } = await import("@/features/code/treeUtils");

const CHANNEL = "oculpm-file-changed";

function fire(op: string, path: string, projectId = 1) {
  const payload = {
    project_id: projectId,
    event: { ts: "", session_id: "", op, path, hash_before: null, hash_after: null, bytes: 0 },
  };
  for (const h of [...(handlers.get(CHANNEL) ?? [])]) h({ payload });
}

/** 구독이 (프라미스 한 틱 뒤) 설치될 때까지 기다린다. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** 400ms 병합 창을 넘긴다. */
function flushCoalesce() {
  act(() => {
    vi.advanceTimersByTime(500);
  });
}

/** 읽어 둔 폴더 캐시 흉내 — 실제로는 `DirMap` 이 그대로 들어온다. */
function cache(...dirs: string[]) {
  const set = new Set(dirs);
  return () => set;
}

beforeEach(() => {
  handlers.clear();
  // 0 시작이면 useRefetchOnWake 의 10초 스로틀이 첫 복귀를 삼킨다 (실제로는 늘 큰 값).
  vi.useFakeTimers({ now: new Date("2026-08-31T10:00:00Z") });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("nearestCachedDir", () => {
  it("직계 부모가 캐시에 있으면 그 자리", () => {
    expect(nearestCachedDir("src/a/b.ts", new Set(["", "src", "src/a"]))).toBe("src/a");
  });

  it("폴더째로 생긴 파일은 캐시에 있는 가장 가까운 조상으로 올라간다", () => {
    // `src/new/deep/` 는 방금 생겨 캐시에 없다 — `src` 를 다시 읽어야 나타난다.
    expect(nearestCachedDir("src/new/deep/x.ts", new Set(["", "src"]))).toBe("src");
  });

  it("루트 파일은 루트", () => {
    expect(nearestCachedDir("README.md", new Set([""]))).toBe("");
  });

  it("아무것도 안 읽었으면 null", () => {
    expect(nearestCachedDir("src/a.ts", new Set<string>())).toBeNull();
  });
});

describe("isTreeShapingOp", () => {
  it("내용만 바뀐 update 는 트리와 무관하다", () => {
    expect(isTreeShapingOp("update")).toBe(false);
    expect(isTreeShapingOp("correct")).toBe(false);
    expect(isTreeShapingOp("create")).toBe(true);
    expect(isTreeShapingOp("delete")).toBe(true);
    expect(isTreeShapingOp("rename")).toBe(true);
  });
});

describe("useTreeWatch", () => {
  it("파일이 생기면 그 폴더를 다시 읽으라고 알린다", async () => {
    const onStale = vi.fn();
    renderHook(() => useTreeWatch({ projectId: 1, cachedDirs: cache("", "src"), onStale }));
    await settle();

    fire("create", "src/new.ts");
    flushCoalesce();

    expect(onStale).toHaveBeenCalledTimes(1);
    expect(onStale).toHaveBeenCalledWith(["src"]);
  });

  it("한 번의 폭풍은 한 번의 갱신으로 접힌다 (폴더는 중복 없이)", async () => {
    const onStale = vi.fn();
    renderHook(() =>
      useTreeWatch({ projectId: 1, cachedDirs: cache("", "src", "docs"), onStale }),
    );
    await settle();

    fire("create", "src/a.ts");
    fire("create", "src/b.ts");
    fire("delete", "docs/old.md");
    flushCoalesce();

    expect(onStale).toHaveBeenCalledTimes(1);
    expect(onStale.mock.calls[0][0].sort()).toEqual(["docs", "src"]);
  });

  it("내용만 바뀐 것으로는 아무 일도 안 한다", async () => {
    const onStale = vi.fn();
    renderHook(() => useTreeWatch({ projectId: 1, cachedDirs: cache("", "src"), onStale }));
    await settle();

    fire("update", "src/a.ts");
    flushCoalesce();

    expect(onStale).not.toHaveBeenCalled();
  });

  it("다른 프로젝트의 변경은 무시한다", async () => {
    const onStale = vi.fn();
    renderHook(() => useTreeWatch({ projectId: 1, cachedDirs: cache(""), onStale }));
    await settle();

    fire("create", "a.ts", 2);
    flushCoalesce();

    expect(onStale).not.toHaveBeenCalled();
  });

  it("마스킹된 금지 경로는 트리를 건드리지 않는다", async () => {
    const onStale = vi.fn();
    renderHook(() => useTreeWatch({ projectId: 1, cachedDirs: cache(""), onStale }));
    await settle();

    fire("create", "**redacted/sensitive**:abc123");
    flushCoalesce();

    expect(onStale).not.toHaveBeenCalled();
  });

  it("안 펼친 가지의 변화도 (폴더 없이) 알린다 — 필터용 전량 트리는 갱신돼야 한다", async () => {
    const onStale = vi.fn();
    renderHook(() => useTreeWatch({ projectId: 1, cachedDirs: cache(), onStale }));
    await settle();

    fire("create", "deep/inside/x.ts");
    flushCoalesce();

    expect(onStale).toHaveBeenCalledWith([]);
  });

  it("창으로 돌아오면 읽어 둔 폴더를 통째로 다시 읽는다", async () => {
    const onStale = vi.fn();
    renderHook(() =>
      useTreeWatch({ projectId: 1, cachedDirs: cache("", "src", "docs"), onStale }),
    );
    await settle();

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(onStale).toHaveBeenCalledTimes(1);
    expect(onStale.mock.calls[0][0].sort()).toEqual(["", "docs", "src"]);
  });

  it("언마운트 뒤에는 갱신을 알리지 않는다", async () => {
    const onStale = vi.fn();
    const { unmount } = renderHook(() =>
      useTreeWatch({ projectId: 1, cachedDirs: cache(""), onStale }),
    );
    await settle();

    fire("create", "a.ts");
    unmount();
    flushCoalesce();

    expect(onStale).not.toHaveBeenCalled();
  });
});
