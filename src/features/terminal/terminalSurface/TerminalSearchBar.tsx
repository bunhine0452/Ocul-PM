// 스크롤백 검색 오버레이(⌘F) 의 표시부 — `TerminalSurface.tsx` 에서 옮겨 왔다 (2026-09-15 분할).
// 상태는 `useTerminalSearch` 가 쥐고 여기는 그 값을 그리기만 한다. DOM·클래스 불변.
import { Search, X } from "@/components/Icons";
// 모듈 t() 는 `formatMatchCount`(순수·테스트 대상) 용, useT() 는 컴포넌트 용.
import { t, useT } from "@/i18n";
import type { TerminalHandles } from "../TerminalInstance";
import type { useTerminalSearch } from "./useTerminalSearch";

/**
 * 검색 카운터 표시 — "3/17". 검색어가 없으면 빈 문자열, 일치가 없으면 안내,
 * 결과가 하이라이트 한계를 넘어 활성 인덱스를 못 셀 땐(-1) 총 개수만 보여준다.
 */
export function formatMatchCount(
  query: string,
  matches: { index: number; count: number } | null,
): string {
  if (!query) return "";
  if (!matches) return "";
  if (matches.count === 0) return t("term.matchNone");
  if (matches.index < 0) return t("term.matchCount", { n: matches.count });
  return `${matches.index + 1}/${matches.count}`;
}

type SearchState = ReturnType<typeof useTerminalSearch>;

export interface TerminalSearchBarProps
  extends Pick<
    SearchState,
    "query" | "setQuery" | "matches" | "setMatches" | "searchOptions" | "runSearch" | "closeSearch"
  > {
  focusedHandles: () => TerminalHandles | undefined;
}

export function TerminalSearchBar({
  query,
  setQuery,
  matches,
  setMatches,
  focusedHandles,
  searchOptions,
  runSearch,
  closeSearch,
}: TerminalSearchBarProps) {
  const { t } = useT();
  return (
    <div className="term-search">
      <Search size={13} />
      <input
        autoFocus
        value={query}
        onChange={(e) => {
          const next = e.target.value;
          setQuery(next);
          const h = focusedHandles();
          if (!h) return;
          if (next) h.search.findNext(next, { incremental: true, ...searchOptions() });
          else {
            h.search.clearDecorations();
            setMatches(null);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") runSearch(e.shiftKey ? "prev" : "next");
          else if (e.key === "Escape") closeSearch();
        }}
        placeholder={t("term.searchPlaceholder")}
        aria-label={t("term.searchLabel")}
      />
      <span
        className={"ts-count" + (query && matches?.count === 0 ? " empty" : "")}
        aria-live="polite"
      >
        {formatMatchCount(query, matches)}
      </span>
      <span className="ts-search-keys">{t("term.search.keys")}</span>
      <button
        type="button"
        className="ts-btn"
        onClick={() => runSearch("prev")}
        title={t("term.prevMatch")}
      >
        ↑
      </button>
      <button
        type="button"
        className="ts-btn"
        onClick={() => runSearch("next")}
        title={t("term.nextMatch")}
      >
        ↓
      </button>
      <button
        type="button"
        className="ts-btn"
        onClick={closeSearch}
        aria-label={t("term.closeSearch")}
        title={t("term.closeSearchHint")}
      >
        <X size={13} />
      </button>
    </div>
  );
}
