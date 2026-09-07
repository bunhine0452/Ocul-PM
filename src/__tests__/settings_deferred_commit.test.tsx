/**
 * v2.42.0 `{#settings-slider}` · `{#settings-set-unhandled}`.
 *
 * ## 무엇이 문제였나 (측정: docs/20260904_v242-load-bearing/perf-baseline.md §3)
 *
 * `<input type="range">` 는 드래그하는 동안 프레임마다 `change` 를 쏜다. 그 한
 * 프레임이 그대로 `set("uiScale", …)` 이었고, 짧은 드래그 한 번(20프레임)이
 * **SQLite 쓰기 20 · `setZoom` 20 · `useSettings()` 소비자 재렌더 20** 이었다.
 * 여기에 창 수만큼 더 붙는다 — 백엔드가 쓰기마다 모든 창에 `SettingsChanged` 를
 * 쏘고, 각 창이 설정 테이블 **전체 조회**로 답한다.
 *
 * 그리고 그 쓰기는 실패해도 아무 말이 없었다: `set()` 은 `async` 인데 봉투의
 * `status` 를 보지 않았고, 12곳이 그것을 `void` 도 `catch` 도 없이 버렸다.
 * 화면은 낙관적으로 새 값을 그린 뒤라 **사용자는 저장됐다고 믿었다.**
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

const backend = { writes: [] as Array<[string, string]>, fail: false };

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "settingsSet")
            return (k: string, v: string) => {
              backend.writes.push([k, v]);
              return backend.fail
                ? Promise.resolve({ status: "error" as const, error: "disk is full" })
                : ok(null);
            };
          if (prop === "settingsGetAll") return () => ok([] as Array<[string, string]>);
          return () => ok(null);
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

import { SettingsProvider, useSettings } from "@/contexts/SettingsContext";
import { useDeferredCommit, DEFERRED_COMMIT_MS } from "@/features/settings/useDeferredCommit";
import { useSaveSetting } from "@/features/settings/saveSetting";
import { getToasts, dismissToast } from "@/lib/toast";

beforeEach(() => {
  backend.writes = [];
  backend.fail = false;
  for (const t of [...getToasts()]) dismissToast(t.id);
});
afterEach(() => cleanup());

const settle = () => act(async () => { await Promise.resolve(); });

// ── 미리보기와 커밋을 가른다 ──────────────────────────────────────────────

describe("useDeferredCommit", () => {
  /** 훅만 띄우는 최소 하네스 — 슬라이더 20프레임을 그대로 흉내낸다. */
  function mount(delayMs = 10_000) {
    const seen: number[] = [];
    const previews: number[] = [];
    let api: ReturnType<typeof useDeferredCommit<number>> | null = null;
    function Probe({ value }: { value: number }) {
      api = useDeferredCommit(value, (v) => seen.push(v), {
        delayMs,
        preview: (v) => previews.push(v),
      });
      return <span data-testid="shown">{api.value}</span>;
    }
    const r = render(<Probe value={1} />);
    return { seen, previews, api: () => api!, r };
  }

  it("20프레임 드래그는 쓰기 0번 · 미리보기 20번 — 커밋은 놓을 때 한 번", async () => {
    const h = mount();
    for (let i = 0; i < 20; i++) await act(async () => h.api().change(0.7 + i * 0.01));

    // 예전에는 여기서 이미 쓰기가 20번 나갔다.
    expect(h.seen).toEqual([]);
    // 미리보기(= 네이티브 줌)는 프레임마다 — 그게 슬라이더의 요점이다.
    expect(h.previews).toHaveLength(20);
    // 화면은 초안을 그린다 (라벨·숫자가 즉시 따라온다).
    expect(h.r.getByTestId("shown").textContent).toBe(String(0.7 + 19 * 0.01));

    await act(async () => h.api().flush());
    expect(h.seen).toEqual([0.7 + 19 * 0.01]);
  });

  it("놓는 순간을 못 봐도 디바운스가 한 번은 커밋한다", async () => {
    vi.useFakeTimers();
    try {
      const h = mount(DEFERRED_COMMIT_MS);
      for (let i = 0; i < 5; i++) act(() => h.api().change(i));
      expect(h.seen).toEqual([]);
      act(() => vi.advanceTimersByTime(DEFERRED_COMMIT_MS + 1));
      expect(h.seen).toEqual([4]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("드래그 도중 언마운트되면 마지막 값을 잃지 않고 흘려보낸다", async () => {
    const h = mount();
    await act(async () => h.api().change(1.25));
    expect(h.seen).toEqual([]);
    // 창을 닫거나 설정 탭을 옮긴 순간.
    await act(async () => h.r.unmount());
    expect(h.seen).toEqual([1.25]);
  });

  it("한 번에 고른 값(프리셋 버튼)은 즉시 커밋된다", async () => {
    const h = mount();
    await act(async () => h.api().commit(1.1));
    expect(h.seen).toEqual([1.1]);
  });
});

// ── 실패를 말한다 ─────────────────────────────────────────────────────────

describe("거절된 설정 쓰기", () => {
  function Probe() {
    const save = useSaveSetting();
    const { settings } = useSettings();
    return (
      <button onClick={() => save("uiScale", 1.25)}>{String(settings.uiScale)}</button>
    );
  }

  it("성공하면 조용히 값을 그대로 흘려보낸다", async () => {
    const r = render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    await settle();
    await act(async () => r.getByRole("button").click());
    await settle();
    expect(backend.writes).toEqual([["ui_scale", "1.25"]]);
    expect(getToasts()).toHaveLength(0);
  });

  it("토스트로 말한다 — 예전엔 화면이 새 값을 조용히 그렸다", async () => {
    backend.fail = true;
    const r = render(
      <SettingsProvider>
        <Probe />
      </SettingsProvider>,
    );
    await settle();
    await act(async () => r.getByRole("button").click());
    await settle();
    const toasts = getToasts();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].kind).toBe("destructive");
    // 원인이 문구에 실린다 — "저장 실패" 만으로는 고칠 방법이 없다.
    expect(toasts[0].message).toContain("disk is full");
  });
});
