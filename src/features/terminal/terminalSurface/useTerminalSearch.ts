// 스크롤백 검색(⌘F) 상태·조작 — `TerminalSurface.tsx` 에서 옮겨 왔다 (2026-09-15 분할).
// 검색은 항상 포커스된 페인이 대상이다 — 그 핸들은 본체가 함수로 건넨다. 동작 불변.
import { useState } from "react";
import type { TerminalHandles } from "../TerminalInstance";
import { readSearchDecorations } from "../termTheme";

export function useTerminalSearch(focusedHandles: () => TerminalHandles | undefined) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  // 검색 결과 카운터 "3/17" — SearchAddon.onDidChangeResults 가 채운다.
  const [matches, setMatches] = useState<{ index: number; count: number } | null>(null);

  const openSearch = () => setSearchOpen(true);
  const closeSearch = () => {
    setSearchOpen(false);
    setMatches(null);
    focusedHandles()?.search.clearDecorations();
    focusedHandles()?.term.focus();
  };
  // 하이라이트 색은 테마 토큰에서 매번 새로 읽는다 (테마 전환 즉시 반영).
  const searchOptions = () => ({ decorations: readSearchDecorations() });
  const runSearch = (dirn: "next" | "prev") => {
    const h = focusedHandles();
    if (!h || !query) return;
    if (dirn === "next") h.search.findNext(query, searchOptions());
    else h.search.findPrevious(query, searchOptions());
  };

  return {
    searchOpen,
    query,
    setQuery,
    matches,
    setMatches,
    openSearch,
    closeSearch,
    searchOptions,
    runSearch,
  };
}
