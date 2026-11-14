import { useEffect, useRef, useState, type RefObject } from "react";
import { SearchIcon, X } from "@/components/Icons";
import { useT } from "@/i18n";

/** 검색은 디바운스한다 — 키 입력마다 전체 기간을 묻지 않는다. */
const DEBOUNCE_MS = 250;

/**
 * 일지 검색칸 (11-15) — 칸의 글자는 이 컴포넌트가 쥐고, **디바운스한 검색어만** 위로 올린다.
 * 예전엔 화면이 글자를 쥐어 한 글자 칠 때마다 목록 전체와 열린 diff 가 다시 그려졌다.
 *
 * ↓ · Enter 는 첫 결과로 간다(기다리지 않고 지금 글자로 바로 찾는다). Esc 는 글자를 지우고, 빈 칸에서
 * 한 번 더 누르면 칸을 떠나 목록으로 돌아간다.
 */
export function JournalSearchInput({
  inputRef,
  onQuery,
  onFirst,
  onLeave,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  /** 디바운스한 검색어(앞뒤 공백 없음). 칸이 비면 곧바로 빈 문자열. */
  onQuery: (query: string) => void;
  /** ↓ · Enter — 지금 글자로 찾은 첫 결과로. */
  onFirst: (query: string) => void;
  /** 빈 칸에서 Esc — 목록으로 돌아간다. */
  onLeave: () => void;
}) {
  const { t } = useT();
  const [value, setValue] = useState("");
  // 부모가 렌더마다 새 함수를 줘도 디바운스가 다시 걸리지 않게.
  const onQueryRef = useRef(onQuery);
  onQueryRef.current = onQuery;

  useEffect(() => {
    const q = value.trim();
    if (q === "") {
      onQueryRef.current("");
      return;
    }
    const timer = setTimeout(() => onQueryRef.current(q), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);

  return (
    <div className="search-box sm jl-search">
      <SearchIcon size={15} color="var(--text-2)" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            if (value) setValue("");
            else {
              e.currentTarget.blur();
              onLeave();
            }
            return;
          }
          // 한글 조합 중의 Enter 는 글자를 맺는 키다 — 결과로 가지 않는다.
          if (e.key === "ArrowDown" || (e.key === "Enter" && !e.nativeEvent.isComposing)) {
            e.preventDefault();
            const q = value.trim();
            onQueryRef.current(q);
            onFirst(q);
          }
        }}
        placeholder={t("journal.searchPlaceholder")}
        aria-label={t("journal.searchAria")}
        spellCheck={false}
      />
      {value ? (
        <button type="button" className="iconbtn sm" onClick={() => setValue("")} aria-label={t("journal.clearSearch")}>
          <X size={13} />
        </button>
      ) : (
        <span className="kbd">/</span>
      )}
    </div>
  );
}
