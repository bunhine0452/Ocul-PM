/**
 * 터미널 찾기 (11-02, ⌘F · 그 밖 Ctrl+Shift+F) — 고른 칸의 출력(스크롤백 포함)에서 찾는다.
 *
 * 칸 오른쪽 위에 한 줄: 입력 · n/m · 대소문자 · 위 · 아래 · 닫기. 치는 대로 찾고(xterm `incremental`),
 * Enter 는 다음, ⇧Enter 는 이전, Esc 는 닫고 입력으로 돌아간다. 장식(찾은 곳 칠하기)은 `termStore` 가.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { ArrowDown, X } from "@/components/Icons";
import { useT } from "@/i18n";
import { clearFind, findInTerm, onFindResult, type FindResult } from "./termStore";

export function TermFindBar({ id, onClose }: { id: number; onClose: () => void }) {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [result, setResult] = useState<FindResult | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  useEffect(() => onFindResult(id, setResult), [id]);

  const go = (back: boolean, q = query, cs = caseSensitive) => {
    if (!q) {
      setResult(null);
      return;
    }
    findInTerm(id, q, back, cs);
  };
  const close = () => {
    clearFind(id);
    onClose();
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      e.preventDefault();
      go(e.shiftKey);
    }
  };

  const count =
    !query || result == null
      ? ""
      : result.count === 0
        ? t("terminal.find.none")
        : result.index < 0
          ? t("terminal.find.many", { n: result.count })
          : t("terminal.find.count", { i: result.index + 1, n: result.count });
  return (
    <div className="tm-find" role="search" aria-label={t("terminal.find.aria")}>
      <input
        ref={input}
        className="tm-find-input"
        value={query}
        placeholder={t("terminal.find.placeholder")}
        aria-label={t("terminal.find.placeholder")}
        spellCheck={false}
        onChange={(e) => {
          setQuery(e.target.value);
          go(false, e.target.value);
        }}
        onKeyDown={onKey}
      />
      <span className={"tm-find-count" + (query && result?.count === 0 ? " is-none" : "")} aria-live="polite">
        {count}
      </span>
      <button
        type="button"
        className="iconbtn sm tm-find-case"
        aria-pressed={caseSensitive}
        aria-label={t("terminal.find.case")}
        title={t("terminal.find.case")}
        onClick={() => {
          setCaseSensitive(!caseSensitive);
          go(false, query, !caseSensitive);
        }}
      >
        Aa
      </button>
      <button type="button" className="iconbtn sm tm-find-up" aria-label={t("terminal.find.prev")} onClick={() => go(true)}>
        <ArrowDown size={13} aria-hidden="true" />
      </button>
      <button type="button" className="iconbtn sm" aria-label={t("terminal.find.next")} onClick={() => go(false)}>
        <ArrowDown size={13} aria-hidden="true" />
      </button>
      <button type="button" className="iconbtn sm" aria-label={t("terminal.find.close")} onClick={close}>
        <X size={11} />
      </button>
    </div>
  );
}
