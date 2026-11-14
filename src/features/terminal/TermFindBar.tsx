/**
 * 터미널 찾기 (11-02, ⌘F · 그 밖 Ctrl+Shift+F) — 고른 칸의 출력(스크롤백 포함)에서 찾는다.
 *
 * 칸 머리 아래 오른쪽에 한 줄: 입력 · n/m · 대소문자 · 정규식 · 위 · 아래 · 닫기. 치는 대로 찾고(xterm
 * `incremental`), Enter 는 다음, ⇧Enter 는 이전, Esc 는 닫고 입력으로 돌아간다. 장식(찾은 곳 칠하기)은 `termStore` 가.
 * 열린 채 ⌘F 를 다시 누르면(`seq`) 찾기 칸으로 돌아와 글자를 고른다.
 *
 * 대체 화면(전체 화면 TUI)에는 스크롤백이 없다 — Ocul 은 Claude Code 를 `CLAUDE_CODE_NO_FLICKER` 로 띄워 대화가
 * 거기 산다. ⌘F 가 보이는 몇 줄만 찾고 「없음」이라 말하던 것 대신, 그 사실 한 줄과 「Claude 에서 찾기」
 * (Claude 의 대화 기록 Ctrl+O 를 열고 / 로 찾기 시작)를 낸다. 일하는 중에는 키가 대화에 섞이니 막는다.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { terminalApi } from "@/api/terminal";
import { ArrowDown, X } from "@/components/Icons";
import { useT } from "@/i18n";
import { blocked } from "@/lib/blocked";
import { observeTerminalTheme } from "./termTheme";
import { clearFind, clearFindDecor, findInTerm, focusTerm, isAltScreen, onFindResult, type FindResult } from "./termStore";

/** Ctrl+O(대화 기록 열기) 뒤 / 를 넣기까지 — Claude Code 가 화면을 바꿀 틈. */
const TRANSCRIPT_SETTLE_MS = 80;

export interface TermFindBarProps {
  id: number;
  /** ⌘F 를 누를 때마다 오른다 — 그때마다 찾기 칸으로 돌아온다. */
  seq: number;
  /** 안의 프로그램이 claude 인가 — 대체 화면 안내가 「Claude 에서 찾기」 를 낸다. */
  claude: boolean;
  /** 지금 일하는 중인가 — 「Claude 에서 찾기」 는 그동안 막는다. */
  working: boolean;
  onClose: () => void;
}

function validRegex(q: string): boolean {
  try {
    new RegExp(q);
    return true;
  } catch {
    return false;
  }
}

export function TermFindBar({ id, seq, claude, working, onClose }: TermFindBarProps) {
  const { t } = useT();
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [result, setResult] = useState<FindResult | null>(null);
  const [alt, setAlt] = useState(() => isAltScreen(id));
  const input = useRef<HTMLInputElement | null>(null);
  const latest = useRef({ query, caseSensitive, regex });
  latest.current = { query, caseSensitive, regex };

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
    setAlt(isAltScreen(id));
  }, [seq, id]);
  useEffect(() => onFindResult(id, setResult), [id]);
  // 칸을 바꾸거나 닫혀 내려가면 칠한 것을 지운다 — 다른 칸을 고른 뒤에도 이전 칸에 남아 있었다.
  useEffect(() => () => clearFindDecor(id), [id]);
  // 테마 · 프로젝트 색이 바뀌면 같은 자리를 새 색으로 다시 칠한다(지금 곳은 그대로 — incremental).
  useEffect(
    () =>
      observeTerminalTheme(() => {
        const q = latest.current;
        if (!q.query || (q.regex && !validRegex(q.query))) return;
        findInTerm(id, q.query, false, { caseSensitive: q.caseSensitive, regex: q.regex, incremental: true, repaint: true });
      }),
    [id],
  );

  const badRegex = regex && query !== "" && !validRegex(query);
  const go = (back: boolean, q = query, cs = caseSensitive, re = regex, incremental = false) => {
    if (!q || (re && !validRegex(q))) {
      setResult(null);
      return;
    }
    findInTerm(id, q, back, { caseSensitive: cs, regex: re, incremental });
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
  // Claude 의 대화 기록(Ctrl+O)을 열고 그 안에서 찾기(/)를 시작한다 — 사람이 누를 때만, 일하는 중이 아닐 때만.
  const findInClaude = async () => {
    clearFindDecor(id);
    onClose();
    await terminalApi.write(id, "\x0f").catch(() => {});
    await new Promise((r) => setTimeout(r, TRANSCRIPT_SETTLE_MS));
    await terminalApi.write(id, "/").catch(() => {});
    focusTerm(id);
  };

  const count = badRegex
    ? t("terminal.find.badRegex")
    : !query || result == null
      ? ""
      : result.count === 0
        ? t("terminal.find.none")
        : result.index < 0
          ? t("terminal.find.many", { n: result.count })
          : t("terminal.find.count", { i: result.index + 1, n: result.count });
  return (
    <div className="tm-find" role="search" aria-label={t("terminal.find.aria")}>
      <div className="tm-find-row">
        <input
          ref={input}
          className="tm-find-input"
          value={query}
          placeholder={t("terminal.find.placeholder")}
          aria-label={t("terminal.find.placeholder")}
          aria-invalid={badRegex || undefined}
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          onChange={(e) => {
            setQuery(e.target.value);
            go(false, e.target.value, caseSensitive, regex, true);
          }}
          onKeyDown={onKey}
        />
        <span
          className={"tm-find-count" + ((query && result?.count === 0) || badRegex ? " is-none" : "")}
          aria-live="polite"
        >
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
            go(false, query, !caseSensitive, regex, true);
          }}
        >
          Aa
        </button>
        <button
          type="button"
          className="iconbtn sm tm-find-case tm-find-regex"
          aria-pressed={regex}
          aria-label={t("terminal.find.regex")}
          title={t("terminal.find.regex")}
          onClick={() => {
            setRegex(!regex);
            go(false, query, caseSensitive, !regex, true);
          }}
        >
          .*
        </button>
        <button type="button" className="iconbtn sm tm-find-up" aria-label={t("terminal.find.prev")} onClick={() => go(true)}>
          <ArrowDown size={13} aria-hidden="true" />
        </button>
        <button type="button" className="iconbtn sm" aria-label={t("terminal.find.next")} onClick={() => go(false)}>
          <ArrowDown size={13} aria-hidden="true" />
        </button>
        <button type="button" className="iconbtn sm" aria-label={t("terminal.find.close")} onClick={close}>
          <X size={13} aria-hidden="true" />
        </button>
      </div>
      {alt ? (
        <div className="tm-find-alt">
          <span className="tm-find-alt-text">{t(claude ? "terminal.find.altClaude" : "terminal.find.altOther")}</span>
          {claude ? (
            <button
              type="button"
              className="btn sm"
              {...blocked(working ? t("terminal.find.claudeBusy") : null, t("terminal.find.inClaudeTitle"))}
              onClick={() => void findInClaude()}
            >
              {t("terminal.find.inClaude")}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
