import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

// ─── 범용 렌더 경계 (2026-08-16) ─────────────────────────────────────────────
//
// 계약은 하나다: **경계 안의 예외가 경계 밖을 지우면 안 된다.** 경계가 없던
// 시절엔 화면 한 조각의 예외가 루트까지 언마운트해 창 전체가 빈 화면이 됐다
// (터미널 2026-07-31 · 시작 탭 설정의 ocul-pm 화면 2026-08-16).

const logError = vi.fn();
vi.mock("@/lib/oculpmLog", () => ({
  oculpmLog: { error: (...args: unknown[]) => logError(...args), warn: vi.fn(), info: vi.fn(), flow: vi.fn() },
}));

import { ErrorBoundary } from "@/components/ErrorBoundary";

function Boom({ throwNow }: { throwNow: boolean }): React.ReactElement {
  if (throwNow) throw new Error("의도적 폭발");
  return <p>정상 내용</p>;
}

/**
 * "다시 시도" 검증용 — 던질지 말지를 **렌더 밖**의 플래그가 정한다.
 *
 * 렌더 안에서 플래그를 뒤집으면(첫 렌더만 던지게 하면) 안 된다: React 19 는
 * 렌더 중 예외가 나면 같은 트리를 동기로 한 번 더 그려 보고, 그때 성공하면
 * 폴백 없이 조용히 복구한다 — 경계가 뜨지 않아 테스트가 아무것도 검증하지
 * 못한다.
 */
let shouldThrow = true;
function Retryable(): React.ReactElement {
  if (shouldThrow) throw new Error("복구 가능한 폭발");
  return <p>복구됨</p>;
}

beforeEach(() => {
  logError.mockClear();
  shouldThrow = true;
  // React 는 잡힌 예외도 콘솔에 다시 뱉는다 — 테스트 출력만 조용하게 한다.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ErrorBoundary", () => {
  it("자식이 던져도 경계 밖 형제는 살아남는다", () => {
    render(
      <div>
        <p>바깥 내용</p>
        <ErrorBoundary label="test">
          <Boom throwNow />
        </ErrorBoundary>
      </div>,
    );

    expect(screen.getByText("바깥 내용")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("이 부분을 그리지 못했어요");
    expect(screen.getByText("의도적 폭발")).toBeInTheDocument();
  });

  it("멀쩡할 때는 아무것도 끼어들지 않는다", () => {
    render(
      <ErrorBoundary label="test">
        <Boom throwNow={false} />
      </ErrorBoundary>,
    );

    expect(screen.getByText("정상 내용")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("'다시 시도' 는 하위 트리를 다시 마운트한다", () => {
    render(
      <ErrorBoundary label="test">
        <Retryable />
      </ErrorBoundary>,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();

    // 원인이 사라진 뒤 다시 시도 — 창을 재시작하지 않고 그 자리에서 살아난다.
    shouldThrow = false;
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(screen.getByText("복구됨")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("진단 로그에 경계 이름과 함께 남긴다 (oculpm.log 에서 조각을 구분하는 단서)", () => {
    render(
      <ErrorBoundary label="settings">
        <Boom throwNow />
      </ErrorBoundary>,
    );

    expect(logError).toHaveBeenCalledTimes(1);
    const [target, message] = logError.mock.calls[0] as [string, string];
    expect(target).toBe("ui");
    expect(message).toContain("[settings]");
    expect(message).toContain("의도적 폭발");
  });
});
