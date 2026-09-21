// 검색 화면 「일지」 스코프 결과 리스트 (journal-scale-round {#search-scope-ui}).
// 순수 프레젠테이션 컴포넌트라 API 목 없이 props 만으로 검증한다.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { JournalSearchHit } from "@/lib/bindings";

import { t } from "@/i18n";
import { JournalScopeResults } from "@/features/search/JournalScopeResults";

afterEach(() => cleanup());

// 픽스처 텍스트는 일부러 영문으로 둔다 — 한글 하드코딩 게이트(check-no-hardcoded-korean)
// 대상은 UI 카피지 이 파일의 검사 재료가 아니라 fixture 데이터다.
function hit(over: Partial<JournalSearchHit> = {}): JournalSearchHit {
  return {
    relative_path: "20260921/Bugs/0900_bug_ime.md",
    workday: "20260921",
    entry_type: "bug",
    status: "done",
    title: "fix ime composition bug",
    snippet: "fixed a terminal ime composition stream issue",
    matched_field: "body",
    why: "ime composition",
    score: 3.5,
    ...over,
  };
}

describe("JournalScopeResults", () => {
  // query="" — splitMatch 는 빈 쿼리에서 원문을 쪼개지 않는다(searchUtils.ts).
  // 하이라이트 자체는 splitMatch 의 순수 함수 테스트(search_utils.test.ts)가
  // 이미 덮으므로, 여기서는 단일 텍스트 노드로 안정적인 조회를 우선한다.
  it("renders the N-of-total header and each row's title/snippet", () => {
    render(
      <JournalScopeResults
        hits={[hit()]}
        total={5}
        query=""
        canMore={false}
        onMore={() => {}}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText(t("search.journalCount", { n: 1, total: 5 }))).toBeTruthy();
    expect(screen.getByText("fix ime composition bug")).toBeTruthy();
    expect(screen.getByText("fixed a terminal ime composition stream issue")).toBeTruthy();
  });

  it("opens the entry on row click and offers more only when canMore", () => {
    const onOpen = vi.fn();
    const onMore = vi.fn();
    const { rerender } = render(
      <JournalScopeResults
        hits={[hit(), hit({ relative_path: "20260920/Chores/1000_chore_x.md", title: "a different entry" })]}
        total={20}
        query=""
        canMore={true}
        onMore={onMore}
        onOpen={onOpen}
      />,
    );

    fireEvent.click(screen.getByText("a different entry"));
    expect(onOpen).toHaveBeenCalledWith("20260920/Chores/1000_chore_x.md");

    fireEvent.click(screen.getByRole("button", { name: t("search.more") }));
    expect(onMore).toHaveBeenCalledTimes(1);

    rerender(
      <JournalScopeResults
        hits={[hit()]}
        total={1}
        query=""
        canMore={false}
        onMore={onMore}
        onOpen={onOpen}
      />,
    );
    expect(screen.queryByRole("button", { name: t("search.more") })).toBeNull();
  });
});
