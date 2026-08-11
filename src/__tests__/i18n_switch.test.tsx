import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";

import { __resetLangForTests, setLangSetting, useT } from "@/i18n";
import { NAV_ENTRIES } from "@/lib/navRegistry";

// i18n Phase 0 배선의 **핵심 계약**: 설정에서 언어를 바꾸면 이미 마운트된
// 컴포넌트가 다시 그려져야 한다 (docs/20260811_three-features/03-i18n.md §4.3).
//
// `t()` 를 훅 없이 부르면 그 컴포넌트는 언어를 바꿔도 안 바뀐다 — 그게 이
// 설계의 유일한 발등 찍기라 여기서 못박는다.

afterEach(() => {
  cleanup();
  __resetLangForTests();
});

function NavLabels() {
  const { t, lang } = useT();
  return (
    <ul data-testid="nav" data-lang={lang}>
      {NAV_ENTRIES.map((e) => (
        <li key={e.id}>{t(e.labelKey)}</li>
      ))}
    </ul>
  );
}

describe("언어 전환 → 리렌더", () => {
  it("useT 로 그린 라벨은 언어를 바꾸면 즉시 갱신된다", () => {
    setLangSetting("ko");
    render(<NavLabels />);
    expect(screen.getByText("작업 일지")).toBeInTheDocument();
    expect(screen.queryByText("Work Journal")).not.toBeInTheDocument();

    // 설정 변경은 React 트리 밖(모듈 스토어)에서 일어난다 —
    // useSyncExternalStore 구독이 살아 있어야 이 전환이 화면에 도달한다.
    act(() => setLangSetting("en"));

    expect(screen.getByText("Work Journal")).toBeInTheDocument();
    expect(screen.queryByText("작업 일지")).not.toBeInTheDocument();
  });

  it("훅이 노출하는 lang 도 함께 바뀐다", () => {
    setLangSetting("ko");
    render(<NavLabels />);
    expect(screen.getByTestId("nav")).toHaveAttribute("data-lang", "ko");

    act(() => setLangSetting("en"));
    expect(screen.getByTestId("nav")).toHaveAttribute("data-lang", "en");
  });

  it("모든 내비 항목이 양 언어에서 비어 있지 않게 해석된다", () => {
    // labelKey 오타는 typecheck 가 잡지만, 사전에 키만 있고 값이 빈 경우는
    // 못 잡는다 — 사이드바에 빈 칸이 뜨는 실패 모드.
    for (const lang of ["ko", "en"] as const) {
      setLangSetting(lang);
      cleanup();
      render(<NavLabels />);
      const items = screen.getByTestId("nav").querySelectorAll("li");
      expect(items).toHaveLength(NAV_ENTRIES.length);
      items.forEach((li, i) => {
        expect(li.textContent?.trim(), `${lang}: ${NAV_ENTRIES[i].labelKey}`).toBeTruthy();
      });
    }
  });
});
