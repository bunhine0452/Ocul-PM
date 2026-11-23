import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";

import { __resetLangForTests, loadDict, setLangSetting } from "@/i18n";
import { Num } from "@/features/today/todayFormat";

// 10-30: 영어 오늘 화면 머리가 「34 {n|entry|entries}」 로 그려졌다 — Num 이 값 없이 사전 문장을
// 받아 단수/복수 갈래가 풀리지 않았다. 숫자만 굵게 하는 것은 그대로 지킨다.
afterEach(() => {
  cleanup();
  __resetLangForTests();
});

describe("Num", () => {
  it("resolves the English plural and keeps only the number bold", async () => {
    await loadDict("en");
    setLangSetting("en");
    const many = render(<Num k="today.arrived.stale" n={34} />);
    expect(many.container.textContent).toBe("Last pushed or pulled 34 days ago");
    expect(many.container.querySelector("b")?.textContent).toBe("34");
    cleanup();
    const one = render(<Num k="today.arrived.stale" n={1} />);
    expect(one.container.textContent).toBe("Last pushed or pulled 1 day ago");
  });

  it("keeps the Korean sentence around the bold number", () => {
    setLangSetting("ko");
    const { container } = render(<Num k="today.arrived.stale" n={58} />);
    expect(container.textContent).toBe("다른 기기와 주고받은 지 58일");
    expect(container.querySelector("b")?.textContent).toBe("58");
  });
});
