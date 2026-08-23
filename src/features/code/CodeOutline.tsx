// 아웃라인 — 지금 보고 있는 파일의 구조. 사이드바 아래쪽에 접이식으로 앉는다
// (VS Code 탐색기와 같은 자리).
//
// 백엔드가 계층을 **평면 목록 + depth** 로 펴서 주므로 여기서는 들여쓰기만 하면
// 된다 — 재귀 렌더도, 재귀 타입도 없다.
import { memo } from "react";

import { ChevronRight } from "@/components/Icons";
import { t, useT } from "@/i18n";
import type { LspSymbol } from "@/lib/bindings";

interface CodeOutlineProps {
  /** null = 아직 안 물음(파일 없음), [] = 물었는데 없음. 이 둘은 다른 상태다. */
  symbols: LspSymbol[] | null;
  loading: boolean;
  open: boolean;
  /** 커서가 있는 줄 (1-based) — 지금 어느 심볼 안인지 표시한다. */
  cursorLine: number;
  onToggleOpen: () => void;
  /** 0-based 줄로 점프. */
  onJump: (line: number, character: number) => void;
}

export const CodeOutline = memo(function CodeOutline({
  symbols,
  loading,
  open,
  cursorLine,
  onToggleOpen,
  onJump,
}: CodeOutlineProps) {
  useT();
  const activeIndex = symbols ? indexOfEnclosing(symbols, cursorLine - 1) : -1;

  return (
    <div className={"code-outline" + (open ? " open" : "")}>
      <button
        type="button"
        className="code-outline-head"
        onClick={onToggleOpen}
        aria-expanded={open}
      >
        <ChevronRight size={12} className={"code-tree-caret" + (open ? " open" : "")} />
        <span className="code-outline-title">{t("code.outline.title")}</span>
        {symbols && symbols.length > 0 ? (
          <span className="code-outline-count">{symbols.length}</span>
        ) : null}
      </button>

      {open ? (
        <div className="code-outline-body" role="tree" aria-label={t("code.outline.title")}>
          {loading ? (
            <div className="code-outline-hint">{t("code.tree.loading")}</div>
          ) : symbols == null ? (
            <div className="code-outline-hint">{t("code.outline.noFile")}</div>
          ) : symbols.length === 0 ? (
            // "서버가 없다" 와 "구조가 없다" 를 여기서 구별하지 않는다 — 어느
            // 쪽이든 사용자가 할 일은 같고, 서버 상태는 상태줄이 이미 말한다.
            <div className="code-outline-hint">{t("code.outline.empty")}</div>
          ) : (
            symbols.map((sym, i) => (
              <button
                key={`${sym.line}:${sym.character}:${sym.name}:${i}`}
                type="button"
                role="treeitem"
                aria-selected={i === activeIndex}
                className={"code-outline-row" + (i === activeIndex ? " on" : "")}
                style={{ paddingLeft: 10 + sym.depth * 12 }}
                title={sym.detail ? `${sym.name} ${sym.detail}` : sym.name}
                onClick={() => onJump(sym.line, sym.character)}
              >
                <span className={"code-outline-kind k-" + sym.kind} aria-hidden />
                <span className="code-outline-name">{sym.name}</span>
                {sym.detail ? <span className="code-outline-detail">{sym.detail}</span> : null}
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
});

/**
 * 커서가 들어 있는 심볼의 index.
 *
 * 백엔드가 시작 줄만 주므로 끝은 **다음 심볼의 시작**으로 추정한다 — 목록이
 * 문서 순서라 이 추정이 성립한다. 정확한 범위가 필요한 기능이 아니라
 * "지금 어디쯤인지" 를 보여 주는 용도다.
 */
export function indexOfEnclosing(symbols: LspSymbol[], line: number): number {
  let best = -1;
  for (let i = 0; i < symbols.length; i++) {
    if (symbols[i].line > line) break;
    best = i;
  }
  return best;
}
