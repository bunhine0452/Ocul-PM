import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

// ─── 라이브 갱신 (도그푸딩 2026-08-21) ────────────────────────────────────────
//
// 계약 — 워처가 `.oculpm/` 변경을 알리면 그 화면이 스스로 다시 읽는다. 사용자가
// 우클릭 새로고침을 해야 반영되던 것이 이 훅들이 없던 시절의 증상이다.

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

const { useJournalEvents, useOculpmDataEvents } = await import(
  "@/features/oculpm/useOculpmLive"
);

const DATA = "oculpm-data-changed";
const JOURNAL_PATH = "oculpm-journal-path-changed";
const JOURNAL_ADDED = "oculpm-journal-added";

function fire(name: string, payload: unknown) {
  for (const h of [...(handlers.get(name) ?? [])]) h({ payload });
}

/** 구독이 (프라미스 한 틱 뒤) 설치될 때까지 기다린다. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** 250ms 병합 창을 넘긴다. */
function flushCoalesce() {
  act(() => {
    vi.advanceTimersByTime(300);
  });
}

beforeEach(() => {
  handlers.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("useOculpmDataEvents", () => {
  it("계획 파일이 바뀌면 다시 읽는다", async () => {
    const onChange = vi.fn();
    renderHook(() => useOculpmDataEvents("planner", 1, true, onChange));
    await settle();

    fire(DATA, {
      project_id: 1,
      area: "planner",
      relative_path: ".oculpm/planner/round.md",
      op: "update",
    });
    flushCoalesce();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("다른 영역·다른 프로젝트의 변경은 무시한다", async () => {
    const onChange = vi.fn();
    renderHook(() => useOculpmDataEvents("planner", 1, true, onChange));
    await settle();

    // 같은 프로젝트, 다른 영역.
    fire(DATA, { project_id: 1, area: "discussion", relative_path: "x", op: "update" });
    // 같은 영역, 다른 프로젝트 (창이 여러 개 떠 있을 때).
    fire(DATA, { project_id: 2, area: "planner", relative_path: "y", op: "update" });
    flushCoalesce();

    expect(onChange).not.toHaveBeenCalled();
  });

  it("한 번의 저장이 낸 여러 이벤트를 한 번의 재조회로 접는다", async () => {
    const onChange = vi.fn();
    renderHook(() => useOculpmDataEvents("discussion", 7, true, onChange));
    await settle();

    const ev = {
      project_id: 7,
      area: "discussion",
      relative_path: ".oculpm/discussion/a/discussion.md",
      op: "update",
    };
    fire(DATA, ev);
    fire(DATA, ev);
    fire(DATA, ev);
    flushCoalesce();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("언마운트하면 구독을 끊는다", async () => {
    const onChange = vi.fn();
    const { unmount } = renderHook(() => useOculpmDataEvents("planner", 1, true, onChange));
    await settle();

    unmount();
    await settle();
    fire(DATA, { project_id: 1, area: "planner", relative_path: "z", op: "update" });
    flushCoalesce();

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("useJournalEvents", () => {
  it("일지 삭제(path-changed)에도 다시 읽는다", async () => {
    // 삭제는 캐시 upsert 결과가 없어 journal-added/updated 가 나가지 않는다 —
    // path-changed 가 유일한 신호다.
    const onChange = vi.fn();
    renderHook(() => useJournalEvents(1, true, onChange));
    await settle();

    fire(JOURNAL_PATH, {
      project_id: 1,
      relative_path: ".oculpm/journal/20260821/Bugs/0900_bug_a.md",
      op: "delete",
    });
    flushCoalesce();

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("추가와 경로 변경이 겹쳐도 한 번만 재조회한다", async () => {
    const onChange = vi.fn();
    renderHook(() => useJournalEvents(1, true, onChange));
    await settle();

    fire(JOURNAL_PATH, { project_id: 1, relative_path: "a.md", op: "create" });
    fire(JOURNAL_ADDED, { project_id: 1, summary: { relative_path: "a.md" } });
    flushCoalesce();

    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("창 복귀 재조회", () => {
  it("창으로 돌아오면 이벤트를 놓쳤어도 다시 읽는다", async () => {
    const onChange = vi.fn();
    renderHook(() => useOculpmDataEvents("planner", 1, true, onChange));
    await settle();

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("연달아 들어오는 focus 는 스로틀한다", async () => {
    const onChange = vi.fn();
    renderHook(() => useOculpmDataEvents("planner", 1, true, onChange));
    await settle();

    act(() => {
      window.dispatchEvent(new Event("focus"));
      // macOS 는 창 사이를 오갈 때 focus 를 연달아 쏜다.
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(onChange).toHaveBeenCalledTimes(1);

    // 스로틀 창(10초)이 지나면 다시 확인한다.
    act(() => {
      vi.advanceTimersByTime(11_000);
      window.dispatchEvent(new Event("focus"));
    });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("프로젝트가 없으면 복귀해도 조회하지 않는다", async () => {
    const onChange = vi.fn();
    renderHook(() => useOculpmDataEvents("planner", null, true, onChange));
    await settle();

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(onChange).not.toHaveBeenCalled();
  });
});
