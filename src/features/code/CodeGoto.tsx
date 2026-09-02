// 파일 안에서 이동 (B4) — ⇧⌘O 심볼 · ⌃G 줄.
//
// 설계 SSOT: docs/20260902_vscode-borrows/03-goto.md
//
// ⌘K 팔레트를 늘리지 않는 이유: 팔레트는 창 전역이고 프로젝트 전체가 대상이다.
// 이건 "지금 이 파일" 이 대상이라 목록이 이미 로컬에 있고(아웃라인), 서버
// 왕복이 없다. 둘을 한 위젯에 섞으면 팔레트가 화면 상태에 매이기 시작한다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useModalBehavior } from "@/hooks/useModalBehavior";
import { t, useT } from "@/i18n";
import type { LspSymbol } from "@/lib/bindings";

import { indexOfEnclosing } from "./CodeOutline";
import { clampLine, parseGoto, rankSymbols } from "./gotoModel";

interface CodeGotoProps {
  /** 지금 파일의 심볼. `null` = 아직 못 물음. */
  symbols: LspSymbol[] | null;
  symbolsLoading: boolean;
  /** 문서 줄 수 — 줄 모드의 상한. 0 이면 아직 모른다. */
  lineCount: number;
  /** 열 때의 커서 줄 (1-based). Esc 면 여기로 되돌린다. */
  originLine: number;
  /** ⌃G 로 열었다 — `:` 를 채워 줄 모드로 시작한다. */
  lineMode: boolean;
  /**
   * 미리 점프 · 확정 (1-based 줄, 0-based 열).
   *
   * `focus` 는 에디터가 포커스를 가져갈지 — 훑는 동안(false)은 여기 입력창이
   * 계속 키를 받아야 하고, 확정(true)은 고른 자리에서 바로 타자를 치게 한다.
   */
  onJump: (line: number, character: number | undefined, focus: boolean) => void;
  onClose: () => void;
}

export function CodeGoto({
  symbols,
  symbolsLoading,
  lineCount,
  originLine,
  lineMode,
  onJump,
  onClose,
}: CodeGotoProps) {
  useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState(lineMode ? ":" : "");
  const [active, setActive] = useState(0);

  // 열자마자 화면을 흔들지 않는다 — 첫 미리 점프는 사용자가 움직인 뒤부터.
  const touchedRef = useRef(false);
  // 심볼이 없는 파일이면 줄 모드로 넘어간다. 목록을 물어보는 중일 수 있으므로
  // (아웃라인이 접혀 있으면 이 순간에야 묻는다) 도착한 뒤에 한 번만 본다.
  const autoLineRef = useRef(lineMode);
  useEffect(() => {
    if (autoLineRef.current || symbols == null || symbols.length > 0) return;
    autoLineRef.current = true;
    setInput((prev) => (prev === "" ? ":" : prev));
  }, [symbols]);

  const query = useMemo(() => parseGoto(input), [input]);
  const ranked = useMemo(
    () =>
      query.kind === "line"
        ? []
        : rankSymbols(symbols ?? [], query.kind === "symbol" ? query.needle : ""),
    [query, symbols],
  );

  /**
   * 줄 모드에서 ⏎ 가 갈 자리. 숫자를 아직 안 쳤으면 null.
   *
   * `col` 은 **사람이 치는 1-based 열**이고 점프의 `ch` 는 0-based 오프셋이다
   * (`:12:1` = 그 줄의 첫 칸). 표시와 점프에서 각각 필요해 둘 다 들고 있는다.
   */
  const lineTarget = useMemo(() => {
    if (query.kind !== "line" || query.line == null) return null;
    return { line: clampLine(query.line, lineCount), col: query.character };
  }, [query, lineCount]);
  const lineChar = lineTarget?.col == null ? undefined : Math.max(0, lineTarget.col - 1);

  // 심볼 모드의 첫 선택은 **커서가 들어 있는 심볼** 이다 (아웃라인의 현재 위치
  // 표시와 같은 규칙). 0 번을 고르면 파일 첫 줄이 미리 선택돼 보인다.
  const enclosing = useMemo(
    () => (symbols ? Math.max(0, indexOfEnclosing(symbols, originLine - 1)) : 0),
    [symbols, originLine],
  );
  useEffect(() => {
    if (touchedRef.current) return;
    setActive(enclosing);
  }, [enclosing]);

  // 미리 점프 — 선택이 바뀔 때마다 에디터가 그 자리로 간다. 이 위젯의 값어치
  // 절반이 여기 있다 (목록을 훑는 동안 코드가 따라 움직인다).
  const hit = ranked[active];
  const peekLine = lineTarget ? lineTarget.line : hit ? hit.symbol.line + 1 : null;
  const peekChar = lineTarget ? lineChar : hit?.symbol.character;
  useEffect(() => {
    if (!touchedRef.current || peekLine == null) return;
    onJump(peekLine, peekChar, false);
  }, [peekLine, peekChar, onJump]);

  // 선택이 목록 밖으로 나가면 따라 스크롤한다 (jsdom 에는 이 API 가 없다).
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    el?.scrollIntoView?.({ block: "nearest" });
  }, [active, input]);

  /** Esc — 열 때의 줄로 되돌리고 닫는다. */
  const cancel = useCallback(() => {
    // 포커스는 `useModalBehavior` 가 열기 전 자리로 되돌린다 — 트리에서 열었으면
    // 트리로 간다. 여기서 에디터를 잡으면 그 복원을 덮어쓴다.
    if (touchedRef.current) onJump(originLine, undefined, false);
    onClose();
  }, [onJump, onClose, originLine]);

  useModalBehavior({ open: true, onClose: cancel, panelRef, initialFocusRef: inputRef });

  const commit = useCallback(
    (line: number, character?: number) => {
      onJump(line, character, true);
      onClose();
    },
    [onJump, onClose],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (ranked.length === 0) return;
      touchedRef.current = true;
      setActive((prev) => {
        const next = prev + (e.key === "ArrowDown" ? 1 : -1);
        return (next + ranked.length) % ranked.length;
      });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (lineTarget) commit(lineTarget.line, lineChar);
      else if (hit) commit(hit.symbol.line + 1, hit.symbol.character);
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      // 목록의 끝으로 — 입력 캐럿 이동은 이 위젯에서 쓸 일이 없다.
      if (ranked.length === 0) return;
      e.preventDefault();
      touchedRef.current = true;
      setActive(e.key === "Home" ? 0 : ranked.length - 1);
    }
  };

  const activeId = lineTarget ? "code-goto-opt-line" : hit ? `code-goto-opt-${hit.index}` : undefined;

  return (
    <div
      className="scrim code-goto-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
    >
      <div
        ref={panelRef}
        className="code-goto"
        role="dialog"
        aria-modal="true"
        aria-label={t("code.goto.aria")}
      >
        <input
          ref={inputRef}
          className="code-goto-input"
          value={input}
          onChange={(e) => {
            touchedRef.current = true;
            setInput(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={t("code.goto.placeholder")}
          aria-label={t("code.goto.placeholder")}
          role="combobox"
          aria-expanded
          aria-controls="code-goto-list"
          aria-activedescendant={activeId}
          spellCheck={false}
          autoComplete="off"
        />

        <div
          ref={listRef}
          id="code-goto-list"
          className="code-goto-list"
          role="listbox"
          aria-label={t("code.goto.aria")}
        >
          {lineTarget ? (
            <div
              id="code-goto-opt-line"
              className="code-goto-row on"
              role="option"
              aria-selected
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => commit(lineTarget.line, lineChar)}
            >
              <span className="code-goto-name">
                {lineTarget.col == null
                  ? t("code.goto.lineTo", { line: lineTarget.line })
                  : t("code.goto.lineToCol", { line: lineTarget.line, col: lineTarget.col })}
              </span>
            </div>
          ) : (
            ranked.map((row, i) => (
              <div
                key={`${row.index}:${row.symbol.name}`}
                id={`code-goto-opt-${row.index}`}
                className={"code-goto-row" + (i === active ? " on" : "")}
                role="option"
                aria-selected={i === active}
                // 눌러도 입력 포커스를 뺏지 않는다 — 뺏기면 트랩이 흔들린다.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => commit(row.symbol.line + 1, row.symbol.character)}
              >
                <span className={"code-outline-kind k-" + row.symbol.kind} aria-hidden />
                <span className="code-goto-name">{row.symbol.name}</span>
                {row.container.length > 0 ? (
                  <span className="code-goto-container">{row.container.join(" › ")}</span>
                ) : null}
                <span className="code-goto-line">{row.symbol.line + 1}</span>
              </div>
            ))
          )}
        </div>

        <div className="code-goto-foot">
          <span className="code-goto-empty">{emptyHint(query.kind, ranked.length, symbols, symbolsLoading, lineCount)}</span>
          <span className="code-goto-keys">{t("code.goto.keysHint")}</span>
        </div>
      </div>
    </div>
  );
}

/** 목록이 비어 있을 때 그 이유를 말한다 — 빈 상자는 고장과 구별되지 않는다. */
function emptyHint(
  kind: "empty" | "symbol" | "line",
  count: number,
  symbols: LspSymbol[] | null,
  loading: boolean,
  lineCount: number,
): string {
  if (kind === "line") return t("code.goto.lineHint", { max: Math.max(1, lineCount) });
  if (count > 0) return t("code.goto.count", { count });
  if (loading || symbols == null) return t("code.tree.loading");
  if (symbols.length === 0) return t("code.goto.noSymbols");
  return t("code.goto.noMatch");
}
