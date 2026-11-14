import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

// ─── v3-surface / firstrun — 첫 5분이 사실을 말한다 ──────────────────────────
//
// 이 레인의 주제는 정직이라, 무는 것도 **문구가 아니라 사실과 행동**이다:
//
//  1. EmptyState 두 밀도가 한 컴포넌트로 갈린다 ({#empty-state-component}) —
//     그리고 그 쌍둥이 LoadingState 는 **같은 치수를 입되 갈린다**
//     ({#layout-loading-state}). 여덟 자리가 로딩을 빈 상태로 그렸고 그중
//     다섯은 두 분기가 같은 컴포넌트·같은 props 라, 사용자가 "기다리면
//     채워진다" 와 "원래 비어 있다" 를 구분할 수 없었다.
//  (정직성 감사 카드와 플러그인 온보딩 카드는 4.0 오늘 화면 재설계에서 걷혔다 —
//   기록 없는 변경은 이제 「확인할 것」의 한 행이다: today_v4.test.tsx.)

import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { t } from "@/i18n";

afterEach(cleanup);

describe("LoadingState — same slot, different signal", () => {
  it("wears .es--plain so the slot never shifts", () => {
    const { container } = render(<LoadingState />);
    const root = container.firstElementChild!;
    // 치수를 물려받는 것이 요점이다: 여백은 EmptyState 와 한 곳에서 나온다.
    expect(root.className).toContain("es");
    expect(root.className).toContain("es--plain");
    expect(root.className).toContain("ls");
  });

  it("differs from empty by the status role — no spinner (receipt rule 6)", () => {
    const { container } = render(<LoadingState />);
    const root = container.firstElementChild!;
    // 상태 변화를 보조기술에 알리는 것은 이 쪽만이다 (EmptyState 는 role 없음).
    expect(root.getAttribute("role")).toBe("status");
    // 11-15 — 도는 브랜드 스피너는 걷었다. 300ms 뒤의 정지 글자 하나가 신호다
    // (states_v2.test.tsx 가 그 시계를 문다).
    expect(root.querySelector("svg")).toBeNull();
    expect(root.querySelector(".ls-spin")).toBeNull();
    expect(root.className).toContain("ls--start");
  });

  it("falls back to common.loading, the caller may say more", async () => {
    const { rerender } = render(<LoadingState />);
    expect(await screen.findByText(t("common.loading"))).toBeInTheDocument();
    rerender(<LoadingState>{t("diff.previewLoading")}</LoadingState>);
    expect(await screen.findByText(t("diff.previewLoading"))).toBeInTheDocument();
  });
});

describe("EmptyState — two densities, one component", () => {
  it("plain renders just the line", () => {
    const { container } = render(<EmptyState>nothing here</EmptyState>);
    const root = container.firstElementChild!;
    expect(root.className).toContain("es--plain");
    expect(root.querySelector(".es-title")).toBeNull();
    expect(root.querySelector(".es-actions")).toBeNull();
  });

  it("one shape — left aligned, one sentence, one action (no icon, no title)", () => {
    const { container } = render(
      <EmptyState density="rich" actions={<button>do it</button>}>
        why it is empty
      </EmptyState>,
    );
    const root = container.firstElementChild!;
    expect(root.className).toContain("es--rich");
    expect(root.className).toContain("es--start");
    expect(root.querySelector("svg")).toBeNull();
    expect(root.querySelector(".es-title")).toBeNull();
    expect(screen.getByText("why it is empty")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "do it" })).toBeInTheDocument();
  });
});
