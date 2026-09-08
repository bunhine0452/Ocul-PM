import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, act, fireEvent, render, screen } from "@testing-library/react";

// ─── 페어링 폴링의 수명 (2026-09-08) ─────────────────────────────────────────
//
// 기기 폴링은 5초 × 60 = **5분**을 도는 루프인데, 이것을 끊을 신호가 하나도
// 없었다 — 코드가 만료돼도, 서버를 꺼도, 설정 화면을 떠나도 계속 돌며 백엔드를
// 두드리고 사라진 컴포넌트에 상태를 썼다. 눈에 안 보이는 결함이라 사람이 다시
// 넣기 쉽고, 그래서 여기서 문다.
//
// 세는 것은 **`mobileBridgeDevices` 호출 횟수**다. "루프가 살아 있다" 를 다른
// 방법으로 관찰할 수 없고, 관찰할 수 없으면 회귀도 못 잡는다.

const calls = { devices: 0 };
let expiresInSecs = 300;

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: {
      mobileBridgeStatus: () => ok({ running: true, addr: "100.90.1.2:8787" }),
      mobileBridgeDevices: () => {
        calls.devices += 1;
        return ok([]);
      },
      mobileBridgePairingBegin: () =>
        ok({ code: "123456", url: "http://100.90.1.2:8787/", expires_in_secs: expiresInSecs }),
      mobileBridgeStop: () => ok({ running: false, addr: null }),
      mobileBridgeStart: () => ok({ running: true, addr: "100.90.1.2:8787" }),
      mobileBridgeRevokeDevice: () => ok([]),
    },
  };
});

import { MobileSettings } from "@/features/settings/MobileSettings";

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section aria-label={title}>{children}</section>
);
const Field = ({ children }: { label: string; children: React.ReactNode }) => <div>{children}</div>;

function mount() {
  return render(<MobileSettings Section={Section} Field={Field} />);
}

/** 코드를 발급하고 폴링이 실제로 돌기 시작한 것까지 확인한다. */
async function beginPairing() {
  // 마운트의 첫 조회(status + devices)가 끝나기를 기다린다.
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "페어링 시작" }));
  await act(async () => {});
  const before = calls.devices;
  // 첫 한 바퀴 — 루프가 살아 있다.
  await act(async () => void (await vi.advanceTimersByTimeAsync(5_000)));
  expect(calls.devices).toBe(before + 1);
}

beforeEach(() => {
  calls.devices = 0;
  expiresInSecs = 300;
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("모바일 페어링 기기 폴링", () => {
  /** **화면을 떠나면 멈춘다.** 언마운트 정리는 카운트다운만 걷고 있었다. */
  it("언마운트하면 더 이상 백엔드를 두드리지 않는다", async () => {
    const { unmount } = mount();
    await beginPairing();

    unmount();
    const after = calls.devices;
    // 남은 루프가 있었다면 이 30초 동안 여섯 번 더 돌았을 것이다.
    await act(async () => void (await vi.advanceTimersByTimeAsync(30_000)));
    expect(calls.devices).toBe(after);
  });

  /** **코드가 만료되면 멈춘다.** 코드가 죽었는데 5분을 더 도는 것은 순수한 낭비다. */
  it("코드가 만료되면 폴링도 함께 끝난다", async () => {
    expiresInSecs = 3;
    mount();
    await beginPairing(); // 여기서 이미 5초가 흘러 카운트다운은 0이다

    const after = calls.devices;
    await act(async () => void (await vi.advanceTimersByTimeAsync(30_000)));
    expect(calls.devices).toBe(after);
    // 화면도 만료를 말한다 — 조용히 멈추면 사용자는 코드가 살아 있다고 믿는다.
    expect(screen.getByText(/코드가 만료됐어요/)).toBeTruthy();
  });

  /** **서버를 끄면 멈춘다.** `setPairing(null)` 만으로는 루프가 안 죽었다. */
  it("서버를 끄면 폴링도 함께 끝난다", async () => {
    mount();
    await beginPairing();

    fireEvent.click(screen.getByRole("button", { name: "서버 끄기" }));
    await act(async () => {});
    const after = calls.devices;
    await act(async () => void (await vi.advanceTimersByTimeAsync(30_000)));
    expect(calls.devices).toBe(after);
  });

  /**
   * **두 번 발급해도 루프는 하나다.**
   *
   * 이것이 실제로 일어나던 순서다: 코드가 만료돼 「페어링 시작」이 다시 뜨고,
   * 사용자가 누른다. 고치기 전에는 첫 루프가 여전히 살아 있어 둘이 겹쳤고,
   * 먼저 뜬 쪽은 낡은 기준(`before`)으로 판정했다.
   */
  it("만료 뒤 다시 발급해도 폴링 루프가 겹치지 않는다", async () => {
    expiresInSecs = 3;
    mount();
    await beginPairing(); // 5초가 흘러 코드는 만료됐다 — 첫 루프는 여기서 끝

    fireEvent.click(screen.getByRole("button", { name: "페어링 시작" }));
    await act(async () => {});
    const after = calls.devices;
    // 루프가 둘이면 한 바퀴에 두 번 부른다.
    await act(async () => void (await vi.advanceTimersByTimeAsync(5_000)));
    expect(calls.devices).toBe(after + 1);
  });
});
