import { afterEach, describe, expect, test, vi } from "vitest";

// 2026-08-20 — 릴리스 빌드에서도 재현 순간의 입력 흐름을 받기 위한 링 버퍼.
//
// 계약은 둘이다: (1) 쌓는 동안에는 IPC 가 한 번도 나가지 않는다 — 이 버그는
// 입력 경로가 빨라야만 열리는 경합이라 진단이 관측 대상을 바꾸면 안 된다.
// (2) 사람이 부를 때 한 덩어리로 **한 번** 나간다.

const info = vi.fn();
vi.mock("@/lib/oculpmLog", () => ({ oculpmLog: { info: (...a: unknown[]) => info(...a) } }));

const { dumpImeTrace, pushImeTrace } = await import("@/features/terminal/imeTrace");

afterEach(() => {
  dumpImeTrace("cleanup");
  info.mockClear();
});

describe("imeTrace", () => {
  test("쌓는 동안에는 로그가 한 줄도 나가지 않는다", () => {
    for (let at = 0; at < 50; at += 1) pushImeTrace("input", { value: "가" });
    expect(info).not.toHaveBeenCalled();
  });

  test("덤프는 한 번의 호출로 전부 내보낸다", () => {
    pushImeTrace("keydown", { key: " " });
    pushImeTrace("input", { value: "안녕 " });

    const count = dumpImeTrace("manual");

    expect(count).toBe(2);
    expect(info).toHaveBeenCalledTimes(1);
    const message = String(info.mock.calls[0][1]);
    expect(message).toContain("[IME-DUMP manual]");
    expect(message).toContain("keydown");
    expect(message).toContain("안녕 ");
  });

  test("덤프하고 나면 비워진다 — 다음 재현이 지난 흐름에 묻히지 않게", () => {
    pushImeTrace("input", { value: "가" });
    dumpImeTrace("manual");
    info.mockClear();

    expect(dumpImeTrace("manual")).toBe(0);
    expect(info).not.toHaveBeenCalled();
  });

  test("링을 넘겨도 최근 것만 남고 터지지 않는다", () => {
    for (let at = 0; at < 900; at += 1) pushImeTrace("input", { seq: at });
    const count = dumpImeTrace("manual");
    expect(count).toBe(400);
    expect(String(info.mock.calls[0][1])).toContain('"seq":899');
  });
});
