// B5 로컬 히스토리 — 팝오버·시각 라벨·목록 훅 (06-local-history.md).
//
// 이 기능이 조용히 틀릴 수 있는 곳은 셋이다: 판 순서(최신이 위여야 한다),
// 출처 라벨(사람과 에이전트를 뒤집으면 목록이 거짓말을 한다), 그리고 캡처가
// 워처 뒤에 도는 탓에 **곧바로 물으면 방금 그 판이 없다**는 것.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

import { CodeHistory, versionTimeLabel } from "@/features/code/CodeHistory";
import { HISTORY_REFRESH_DELAY_MS, useFileHistory } from "@/features/code/useFileHistory";
import type { CodeHistoryVersion } from "@/api/codeHistory";
import { t } from "@/i18n";

const listMock = vi.fn();
const forgetMock = vi.fn();

vi.mock("@/api/codeHistory", () => ({
  codeHistoryApi: {
    list: (...args: unknown[]) => listMock(...args),
    forget: (...args: unknown[]) => forgetMock(...args),
  },
}));

function version(over: Partial<CodeHistoryVersion> = {}): CodeHistoryVersion {
  return {
    ts: "1756800000000",
    hash: "abc",
    bytes: 2048,
    source: "agent",
    op: "update",
    ...over,
  };
}

afterEach(cleanup);

describe("versionTimeLabel", () => {
  it("오늘 것은 시:분:초만, 다른 날은 날짜까지", () => {
    const today = new Date(2026, 8, 2, 14, 32, 7).getTime();
    const now = new Date(2026, 8, 2, 18, 0, 0).getTime();
    expect(versionTimeLabel(String(today), now)).not.toContain("/");

    const yesterday = new Date(2026, 8, 1, 9, 5, 0).getTime();
    const label = versionTimeLabel(String(yesterday), now);
    expect(label.length).toBeGreaterThan(versionTimeLabel(String(today), now).length);
  });

  it("숫자가 아니면 눈에 보이는 자리표시자", () => {
    expect(versionTimeLabel("nonsense", Date.now())).toBe("—");
  });
});

describe("CodeHistory", () => {
  function renderPop(versions: CodeHistoryVersion[]) {
    const onPick = vi.fn();
    const onForget = vi.fn();
    const utils = render(
      <CodeHistory versions={versions} onPick={onPick} onForget={onForget} />,
    );
    return { onPick, onForget, ...utils };
  }

  it("백엔드가 준 순서(최신순)를 그대로 그린다", () => {
    const now = Date.now();
    renderPop([
      version({ ts: String(now), hash: "new" }),
      version({ ts: String(now - 60_000), hash: "old" }),
    ]);
    const rows = screen.getAllByTitle(t("code.hist.open"));
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain(versionTimeLabel(String(now), now));
  });

  it("사람과 에이전트를 라벨로 가른다", () => {
    renderPop([
      version({ ts: "1", source: "user" }),
      version({ ts: "2", source: "agent" }),
    ]);
    expect(screen.getByText(new RegExp(t("code.hist.user")))).toBeTruthy();
    expect(screen.getByText(new RegExp(t("code.hist.agent")))).toBeTruthy();
  });

  it("크기를 사람이 읽는 단위로 적는다", () => {
    renderPop([version({ bytes: 2048 })]);
    expect(screen.getByText(/2\.0 KB/)).toBeTruthy();
  });

  it("행을 누르면 그 판으로 비교에 들어간다", () => {
    const v = version({ ts: "42" });
    const { onPick } = renderPop([v]);
    fireEvent.click(screen.getByTitle(t("code.hist.open")));
    expect(onPick).toHaveBeenCalledWith(v);
  });

  it("이 파일의 판을 지우는 문이 팝오버 안에 있다", () => {
    const { onForget } = renderPop([version()]);
    fireEvent.click(screen.getByText(t("code.hist.forget")));
    expect(onForget).toHaveBeenCalled();
  });

  it("빈 목록은 조용히 비지 않고 그렇게 말한다", () => {
    renderPop([]);
    expect(screen.getByText(t("code.hist.empty"))).toBeTruthy();
  });

  it("a11y 위반이 없다", async () => {
    const summarize = (r: AxeResults) =>
      r.violations.map((v: Result) => ({ id: v.id, help: v.help }));
    const { container } = renderPop([version({ ts: "1", source: "user" }), version({ ts: "2" })]);
    expect(
      summarize(await axe(container, { rules: { "color-contrast": { enabled: false } } })),
    ).toEqual([]);
  });
});

describe("useFileHistory", () => {
  beforeEach(() => {
    listMock.mockReset();
    forgetMock.mockReset();
    listMock.mockResolvedValue([version()]);
    forgetMock.mockResolvedValue(null);
  });

  it("파일을 열면 목록을 읽는다", async () => {
    const { result } = renderHook(() => useFileHistory(1, "src/a.ts", true));
    await waitFor(() => expect(result.current.versions).toHaveLength(1));
    expect(listMock).toHaveBeenCalledWith(1, "src/a.ts");
  });

  it("설정이 꺼져 있으면 묻지 않는다 — 칩이 뜰 이유가 없다", async () => {
    renderHook(() => useFileHistory(1, "src/a.ts", false));
    await new Promise((r) => setTimeout(r, 0));
    expect(listMock).not.toHaveBeenCalled();
  });

  it("파일이 없으면 묻지 않는다", async () => {
    renderHook(() => useFileHistory(1, null, true));
    await new Promise((r) => setTimeout(r, 0));
    expect(listMock).not.toHaveBeenCalled();
  });

  it("워처 이벤트는 곧바로가 아니라 잠깐 뒤에 다시 센다 (캡처가 그 뒤에 돈다)", async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useFileHistory(1, "src/a.ts", true));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(listMock).toHaveBeenCalledTimes(1);

      act(() => result.current.refreshSoon());
      act(() => result.current.refreshSoon()); // 연달아 와도 한 번만
      await act(async () => {
        await vi.advanceTimersByTimeAsync(HISTORY_REFRESH_DELAY_MS - 1);
      });
      expect(listMock).toHaveBeenCalledTimes(1);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2);
      });
      expect(listMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("지우면 목록이 비고 다시 묻지 않는다", async () => {
    const { result } = renderHook(() => useFileHistory(1, "src/a.ts", true));
    await waitFor(() => expect(result.current.versions).toHaveLength(1));
    await act(async () => {
      await result.current.forget();
    });
    expect(forgetMock).toHaveBeenCalledWith(1, "src/a.ts");
    expect(result.current.versions).toEqual([]);
  });

  it("목록을 못 읽어도 화면을 깨지 않는다 — 칩이 안 뜰 뿐이다", async () => {
    listMock.mockRejectedValue(new Error("nope"));
    const { result } = renderHook(() => useFileHistory(1, "src/a.ts", true));
    await waitFor(() => expect(listMock).toHaveBeenCalled());
    expect(result.current.versions).toEqual([]);
  });
});
