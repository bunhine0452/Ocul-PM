import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";

import { NAV_HISTORY_CAP, useNavHistory } from "@/hooks/useNavHistory";

// 감사 라운드 2026-09-11 E3 — 화면 뒤로/앞으로. 누가 바꿨든 발자국이 쌓이고,
// 뒤로 간 화면은 앞으로 스택에 남으며, 새 이동은 앞으로 스택을 비운다.

function harness(initial = "today") {
  return renderHook(() => {
    const [view, setView] = useState(initial);
    const nav = useNavHistory(view, setView);
    return { view, setView, ...nav };
  });
}

describe("useNavHistory", () => {
  it("records external navigation and walks back / forward", () => {
    const h = harness();
    act(() => h.result.current.setView("journal"));
    act(() => h.result.current.setView("code"));
    expect(h.result.current.view).toBe("code");

    let ok = false;
    act(() => {
      ok = h.result.current.goBack();
    });
    expect(ok).toBe(true);
    expect(h.result.current.view).toBe("journal");
    act(() => h.result.current.goBack());
    expect(h.result.current.view).toBe("today");
    // 더는 못 간다.
    act(() => {
      ok = h.result.current.goBack();
    });
    expect(ok).toBe(false);

    act(() => h.result.current.goForward());
    expect(h.result.current.view).toBe("journal");
    act(() => h.result.current.goForward());
    expect(h.result.current.view).toBe("code");
    act(() => {
      ok = h.result.current.goForward();
    });
    expect(ok).toBe(false);
  });

  it("a fresh navigation clears the forward stack", () => {
    const h = harness();
    act(() => h.result.current.setView("journal"));
    act(() => h.result.current.goBack());
    act(() => h.result.current.setView("graph"));
    let ok = true;
    act(() => {
      ok = h.result.current.goForward();
    });
    expect(ok).toBe(false);
    act(() => h.result.current.goBack());
    expect(h.result.current.view).toBe("today");
  });

  it("caps the back stack", () => {
    const h = harness("v0");
    for (let i = 1; i <= NAV_HISTORY_CAP + 10; i++) {
      act(() => h.result.current.setView(`v${i}`));
    }
    let steps = 0;
    for (;;) {
      let ok = false;
      act(() => {
        ok = h.result.current.goBack();
      });
      if (!ok) break;
      steps += 1;
    }
    expect(steps).toBe(NAV_HISTORY_CAP);
  });
});
