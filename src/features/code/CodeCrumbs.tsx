// 브레드크럼 — 탭 바 바로 아래, 편집면 위. 폴더 조각 › 파일 › **커서가 든 심볼**.
//
// 어느 폴더의 파일인지 탭 이름만으로는 모른다 (같은 이름의 파일이 흔하다:
// mod.rs · index.ts). 폴더 조각을 누르면 트리에서 펼친다.
//
// 2026-09-11 IDE 라운드에서 `CodePane` 에서 떼어내며 심볼 사슬을 붙였다 —
// 아웃라인이 접혀 있어도 "지금 어느 함수·어느 섹션 안에 있나" 가 늘 한 줄로
// 보인다 (VS Code 의 브레드크럼 심볼 부분). 조각을 누르면 그 심볼로 점프한다.
// 오른쪽 액션(일지 칩 · 판 · svg · HEAD 비교)은 창의 상태라 창이 만들어 넣는다.
import { useMemo, type ReactNode } from "react";

import { ChevronRight } from "@/components/Icons";
import { t, useT } from "@/i18n";
import type { LspSymbol } from "@/lib/bindings";

import { FileIcon } from "./FileIcon";
import { enclosingChain } from "./gotoModel";

interface CodeCrumbsProps {
  path: string;
  /** 지금 파일의 심볼 (아웃라인과 같은 값). `null` 이면 심볼 조각을 안 그린다. */
  symbols: readonly LspSymbol[] | null;
  /** 커서 줄 (1-based). */
  cursorLine: number;
  onRevealDir: (dir: string) => void;
  /** 심볼 조각 클릭 — 그 심볼로 (1-based 줄, 0-based 열). */
  onJumpToSymbol: (line: number, character: number) => void;
  actions?: ReactNode;
}

export function CodeCrumbs({ path, symbols, cursorLine, onRevealDir, onJumpToSymbol, actions }: CodeCrumbsProps) {
  useT();
  const segs = path.split("/");
  const chain = useMemo(
    () => (symbols ? enclosingChain(symbols, cursorLine - 1).map((i) => symbols[i]) : []),
    [symbols, cursorLine],
  );

  return (
    <nav className="code-crumbs" aria-label={t("code.crumbs.aria")}>
      {segs.map((seg, i) => {
        const isLast = i === segs.length - 1;
        const dir = segs.slice(0, i + 1).join("/");
        return (
          <span key={dir} className="code-crumb-seg">
            {i > 0 ? <ChevronRight size={11} className="code-crumb-sep" aria-hidden /> : null}
            {isLast ? (
              <span className={"code-crumb current" + (chain.length > 0 ? " has-sym" : "")}>
                <FileIcon name={seg} size={13} />
                {seg}
              </span>
            ) : (
              <button type="button" className="code-crumb" onClick={() => onRevealDir(dir)}>
                {seg}
              </button>
            )}
          </span>
        );
      })}
      {chain.length > 0 ? (
        <span className="code-crumb-syms" aria-label={t("code.crumbs.symbolAria")}>
          {chain.map((sym, i) => (
            <span key={`${sym.line}:${sym.name}`} className="code-crumb-seg">
              <ChevronRight size={11} className="code-crumb-sep" aria-hidden />
              <button
                type="button"
                className={"code-crumb code-crumb-sym" + (i === chain.length - 1 ? " current" : "")}
                onClick={() => onJumpToSymbol(sym.line + 1, sym.character)}
                title={sym.detail ?? sym.name}
              >
                <span className={"code-outline-kind k-" + sym.kind} aria-hidden />
                {sym.name}
              </button>
            </span>
          ))}
        </span>
      ) : null}
      {actions ? <span className="code-crumbs-actions">{actions}</span> : null}
    </nav>
  );
}
