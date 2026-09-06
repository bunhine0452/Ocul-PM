import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  acpRowSourceOf,
  acpRowStatesNow,
  acpWorkingKey,
  noteAcpSignal,
  resetAcpWorking,
  setAcpWorking,
  SILENCE_MS,
} from "@/features/chat/acpBusyBus";

// 플랜 v3-surface {#working-source}.
//
// 「돌고 있다」 하나로는 스트림이 끊긴 것과 진짜 도는 것을 구별할 수 없다.
// 이 스위트가 지키는 것은 **모른다를 돌고 있다로 말하지 않는 것**이다.

const KEY = acpWorkingKey(1, "s-1");

function sourceNow() {
  return acpRowSourceOf(acpRowStatesNow(), 1, "s-1");
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  resetAcpWorking();
  vi.useRealTimers();
});

describe("바쁨 신호의 출처", () => {
  it("턴을 열면 아직 아무 신호도 못 받았으므로 none 이다", () => {
    setAcpWorking(KEY, true);
    expect(sourceNow()).toBe("none");
  });

  it("글자가 흐르면 typing, 그 밖의 이벤트는 observer", () => {
    setAcpWorking(KEY, true);
    noteAcpSignal(KEY, true);
    expect(sourceNow()).toBe("typing");
    noteAcpSignal(KEY, false);
    expect(sourceNow()).toBe("observer");
  });

  it("신호가 멎으면 none 으로 내려간다 — 모른다고 말한다", () => {
    setAcpWorking(KEY, true);
    noteAcpSignal(KEY, true);
    vi.advanceTimersByTime(SILENCE_MS - 1);
    expect(sourceNow()).toBe("typing");
    vi.advanceTimersByTime(2);
    expect(sourceNow()).toBe("none");
  });

  it("신호가 계속 오면 침묵 타이머가 다시 선다", () => {
    setAcpWorking(KEY, true);
    for (let i = 0; i < 5; i += 1) {
      noteAcpSignal(KEY, false);
      vi.advanceTimersByTime(SILENCE_MS - 100);
    }
    expect(sourceNow()).toBe("observer");
  });

  it("안 도는 세션에는 신호가 붙지 않는다 — 끝난 턴을 되살리지 않는다", () => {
    noteAcpSignal(KEY, true);
    expect(sourceNow()).toBe("none");
  });

  it("턴이 끝나면 출처도 침묵 타이머도 함께 걷힌다", () => {
    setAcpWorking(KEY, true);
    noteAcpSignal(KEY, true);
    setAcpWorking(KEY, false);
    expect(sourceNow()).toBe("none");
    // 걷지 않았다면 여기서 타이머가 죽은 키를 다시 건드린다.
    vi.advanceTimersByTime(SILENCE_MS * 2);
    expect(sourceNow()).toBe("none");
  });
});
