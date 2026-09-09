/**
 * 토스트가 **읽고 누를 시간**을 주는가 (2026-09-09 일관성 라운드).
 *
 * 계기: `useFileOps` 의 파일 옮기기 [되돌리기] 가 `durationMs` 를 안 줘서 info
 * 기본값 5초에 걸려 있었다. 그 토스트가 되돌리기의 **유일한** 경로였고
 * (`undoMoves` 호출부는 코드베이스 전체에서 그 한 줄뿐, 메뉴도 ⌘Z 도 없다),
 * 호버해도 시계가 멈추지 않았다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Toaster } from "@/components/ui/Toaster";
import { dismissToast, getToasts, toast } from "@/lib/toast";

afterEach(() => {
  for (const t of [...getToasts()]) dismissToast(t.id);
  vi.useRealTimers();
});

const noop = () => {};
/** 방금 올린 토스트. (`Array.at` 은 이 저장소의 TS lib 타깃 밖이다.) */
const last = () => {
  const all = getToasts();
  return all[all.length - 1];
};

describe("액션이 달린 토스트는 기본값에 기대도 손해가 안 난다", () => {
  it("durationMs 를 안 주면 info 기본 5초가 아니라 15초 바닥을 쓴다", () => {
    toast.info("옮겼습니다", { actions: [{ label: "되돌리기", onClick: noop }] });
    expect(last().durationMs).toBe(15_000);
  });

  it("액션이 없으면 종류별 기본값 그대로다", () => {
    toast.info("복사됨");
    expect(last().durationMs).toBe(5_000);
  });

  it("짧게 준 값은 바닥까지 올린다", () => {
    toast.info("옮겼습니다", {
      durationMs: 3_000,
      actions: [{ label: "되돌리기", onClick: noop }],
    });
    expect(last().durationMs).toBe(15_000);
  });

  it("0 은 '사용자가 닫을 때까지' 라는 뜻이므로 존중한다", () => {
    toast.info("검토해 주세요", {
      durationMs: 0,
      actions: [{ label: "열기", onClick: noop }],
    });
    expect(last().durationMs).toBe(0);
  });

  it("길게 준 값은 건드리지 않는다", () => {
    toast.warning("확인이 필요합니다", {
      durationMs: 30_000,
      actions: [{ label: "보기", onClick: noop }],
    });
    expect(last().durationMs).toBe(30_000);
  });
});

describe("호버·포커스가 시계를 멈춘다", () => {
  it("마우스를 올린 동안은 자동으로 닫히지 않고, 떼면 남은 시간부터 다시 간다", () => {
    vi.useFakeTimers();
    render(<Toaster />);
    // 스토어 갱신 → useSyncExternalStore 재렌더를 act 로 흘려보낸다.
    act(() => void toast.info("옮겼습니다", { actions: [{ label: "되돌리기", onClick: noop }] }));

    const item = screen.getByText("옮겼습니다").closest("div[class*='pointer-events-auto']")!;
    vi.advanceTimersByTime(10_000); // 15초 중 10초 경과

    fireEvent.mouseEnter(item);
    act(() => void vi.advanceTimersByTime(60_000)); // 멈춰 있으므로 얼마가 지나든 그대로
    expect(getToasts()).toHaveLength(1);

    fireEvent.mouseLeave(item);
    act(() => void vi.advanceTimersByTime(4_000)); // 남은 5초 중 4초 — 아직 살아 있다
    expect(getToasts()).toHaveLength(1);

    act(() => void vi.advanceTimersByTime(1_500));
    expect(getToasts()).toHaveLength(0);
  });
});

describe("라이브 리전은 내용보다 먼저 DOM 에 있다", () => {
  it("토스트가 하나도 없어도 두 리전이 마운트돼 있다", () => {
    const { container } = render(<Toaster />);
    expect(getToasts()).toHaveLength(0);
    expect(container.querySelector('[role="status"][aria-live="polite"]')).toBeTruthy();
    expect(container.querySelector('[role="alert"][aria-live="assertive"]')).toBeTruthy();
  });

  it("info 는 polite 리전, 경고·오류는 assertive 리전에 들어간다", () => {
    const { container } = render(<Toaster />);
    act(() => {
      toast.info("복사됨");
      toast.destructive("지우지 못했어요");
    });

    const polite = container.querySelector('[role="status"][aria-live="polite"]')!;
    const assertive = container.querySelector('[role="alert"][aria-live="assertive"]')!;
    expect(polite.textContent).toContain("복사됨");
    expect(polite.textContent).not.toContain("지우지 못했어요");
    expect(assertive.textContent).toContain("지우지 못했어요");
  });
});
