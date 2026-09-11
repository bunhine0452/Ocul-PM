// ⌘P 빠른 열기 — 프로젝트 전체에서 파일을 이름으로 연다 (2026-09-11 IDE 라운드).
//
// `CodeGoto`(⇧⌘O · 파일 **안**) 와 같은 자리·같은 껍데기(`.code-goto`)를 쓰되
// 대상이 다르다: 저쪽은 지금 파일의 심볼, 이쪽은 프로젝트의 파일. ⌘K 팔레트를
// 늘리지 않는 이유도 같다 — 팔레트는 창 전역이고, 이건 코드 화면의 트리가 이미
// 들고 있는 전량 목록 위에서 도는 로컬 위젯이다 (서버 왕복 없음).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useModalBehavior } from "@/hooks/useModalBehavior";
import { t, useT } from "@/i18n";

import { FileIcon } from "./FileIcon";
import { rankFiles, type QuickOpenFile } from "./quickOpenModel";

interface CodeQuickOpenProps {
  files: readonly QuickOpenFile[];
  /** 전량 트리가 상한에 걸려 잘렸다 — 못 찾는 이유를 말해야 한다. */
  truncated: boolean;
  /** 열려 있는 탭 (최근 순). 빈 질의의 목록이자 동점의 우선순위. */
  openPaths: readonly string[];
  dirtyPaths: ReadonlySet<string>;
  onOpen: (path: string) => void;
  onClose: () => void;
}

export function CodeQuickOpen({ files, truncated, openPaths, dirtyPaths, onOpen, onClose }: CodeQuickOpenProps) {
  useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const [active, setActive] = useState(0);

  const ranked = useMemo(() => rankFiles(files, input, openPaths), [files, input, openPaths]);
  const hit = ranked[Math.min(active, Math.max(0, ranked.length - 1))];

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    el?.scrollIntoView?.({ block: "nearest" });
  }, [active, input]);

  useModalBehavior({ open: true, onClose, panelRef, initialFocusRef: inputRef });

  const commit = useCallback(
    (path: string) => {
      onOpen(path);
      onClose();
    },
    [onOpen, onClose],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (ranked.length === 0) return;
      setActive((prev) => (prev + (e.key === "ArrowDown" ? 1 : -1) + ranked.length) % ranked.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (hit) commit(hit.path);
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      if (ranked.length === 0) return;
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : ranked.length - 1);
    }
  };

  const empty = input.trim().length === 0;
  const hint = truncated && !empty && ranked.length === 0
    ? t("code.quickOpen.truncated")
    : empty
      ? ranked.length > 0
        ? t("code.quickOpen.recentHint")
        : t("code.quickOpen.noRecent")
      : ranked.length > 0
        ? t("code.quickOpen.count", { count: ranked.length })
        : t("code.quickOpen.noMatch");

  return (
    <div
      className="scrim code-goto-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className="code-goto code-qo"
        role="dialog"
        aria-modal="true"
        aria-label={t("code.quickOpen.aria")}
      >
        <input
          ref={inputRef}
          className="code-goto-input"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={t("code.quickOpen.placeholder")}
          aria-label={t("code.quickOpen.placeholder")}
          role="combobox"
          aria-expanded
          aria-controls="code-qo-list"
          aria-activedescendant={hit ? `code-qo-opt-${hit.path}` : undefined}
          spellCheck={false}
          autoComplete="off"
        />

        <div
          ref={listRef}
          id="code-qo-list"
          className="code-goto-list"
          role="listbox"
          aria-label={t("code.quickOpen.aria")}
        >
          {ranked.map((row, i) => (
            <div
              key={row.path}
              id={`code-qo-opt-${row.path}`}
              className={"code-goto-row code-qo-row" + (row === hit ? " on" : "")}
              role="option"
              aria-selected={row === hit}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => commit(row.path)}
              title={row.path}
            >
              <FileIcon name={row.name} size={15} className="code-qo-ico" />
              <span className="code-goto-name">
                {row.name}
                {dirtyPaths.has(row.path) ? <span className="code-qo-dirty" aria-label={t("code.dirty")} /> : null}
              </span>
              {row.dir ? <span className="code-goto-container">{row.dir}</span> : null}
              {row.open ? <span className="code-qo-open">{t("code.quickOpen.open")}</span> : null}
            </div>
          ))}
        </div>

        <div className="code-goto-foot">
          <span className="code-goto-empty">{hint}</span>
          <span className="code-goto-keys">{t("code.quickOpen.keysHint")}</span>
        </div>
      </div>
    </div>
  );
}
