/**
 * v2 U8 (docs/20260706_v2/01-ux-spec.md §3) — 키보드 diff 검토의 **검색** 절반.
 *
 * `/` = in-diff 검색, n/N = 매치 이동. 파일 이동 키(j/k/f)는 표시 순서를 아는
 * `DiffFileList` 가 계속 소유한다. `DiffScreenV2` 에서 그대로 들어냈다
 * (분할 라운드, 플랜 `v3-release` {#planner-diff-split}).
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { DiffMode } from "@/contexts/WorkspaceContext";
import type { DiffResult } from "@/lib/bindings";

export interface DiffSearch {
  /** `/` 가 초점을 주는 입력칸. */
  searchInputRef: RefObject<HTMLInputElement | null>;
  /** 매치를 긁어 오는 diff 본문 컨테이너. */
  diffCodeRef: RefObject<HTMLDivElement | null>;
  query: string;
  setQuery: (query: string) => void;
  /** 현재 매치 위치 (total 0 = 못 찾음). 아직 찾은 적 없으면 null. */
  matchPos: { idx: number; total: number } | null;
  jumpMatch: (dir: 1 | -1) => void;
}

export function useDiffSearch(
  projectId: number,
  selected: string | null,
  diffMode: DiffMode,
  diff: DiffResult | null,
): DiffSearch {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const diffCodeRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState("");
  const [matchPos, setMatchPos] = useState<{ idx: number; total: number } | null>(null);
  const matchIdxRef = useRef(-1);

  // 프로젝트를 갈아타면 이전 프로젝트의 검색어가 새 파일 위에 남지 않는다
  // (사이드바 인라인 전환은 이 화면을 리마운트하지 않는다).
  useEffect(() => {
    setQuery("");
  }, [projectId]);

  // 매치는 렌더된 diff 라인(.dl)의 textContent 로 그때그때 수집한다 — PatchView
  // 내부(하이라이트된 HTML)를 건드리지 않는 최소 침습 접점.
  const jumpMatch = useCallback(
    (dir: 1 | -1) => {
      const root = diffCodeRef.current;
      const q = query.trim().toLowerCase();
      if (!root || !q) return;
      root.querySelectorAll(".dl-hit").forEach((el) => el.classList.remove("dl-hit"));
      const matches = Array.from(root.querySelectorAll<HTMLElement>(".dl")).filter((el) =>
        (el.textContent ?? "").toLowerCase().includes(q),
      );
      if (matches.length === 0) {
        matchIdxRef.current = -1;
        setMatchPos({ idx: 0, total: 0 });
        return;
      }
      const next = (((matchIdxRef.current + dir) % matches.length) + matches.length) % matches.length;
      matchIdxRef.current = next;
      const el = matches[next];
      el.classList.add("dl-hit");
      el.scrollIntoView?.({ block: "center" });
      setMatchPos({ idx: next + 1, total: matches.length });
    },
    [query],
  );

  // 쿼리/파일/모드가 바뀌면 매치 커서 리셋.
  useEffect(() => {
    matchIdxRef.current = -1;
    setMatchPos(null);
    diffCodeRef.current
      ?.querySelectorAll(".dl-hit")
      .forEach((el) => el.classList.remove("dl-hit"));
  }, [query, selected, diffMode, diff]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "/") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if ((e.key === "n" || e.key === "N") && query.trim()) {
        e.preventDefault();
        jumpMatch(e.key === "n" ? 1 : -1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [query, jumpMatch]);

  return { searchInputRef, diffCodeRef, query, setQuery, matchPos, jumpMatch };
}
