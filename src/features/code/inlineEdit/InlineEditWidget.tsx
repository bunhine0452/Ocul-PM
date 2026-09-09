// ⌘K 위젯 — 선택 위에 떠서 지시를 받고, 제안이 오면 조각을 켜고 끈다.
//
// 상태는 `useInlineEdit` 이 들고, 여기는 그것을 그리기만 한다. Monaco 의 content
// widget DOM 안으로 포털돼서 뜬다 — 선택을 따라 움직이는 것은 Monaco 가 한다.

import { useEffect, useRef, useState } from "react";

// 아이콘은 그 자리의 **동작**을 말한다 — 반짝이는 이 저장소에서 금지다
// (de-AI 디자인 규율, `check-design-discipline.mjs`). 여기 동작은 "제자리에서 고쳐 쓰기".
import { Check, Pencil, X } from "@/components/Icons";
import { t } from "@/i18n";
import { hunkStats } from "./hunks";
import type { InlineEditHandle } from "./useInlineEdit";

export function InlineEditWidget({ inline }: { inline: InlineEditHandle }) {
  const { phase } = inline;
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // 열리면 바로 칠 수 있어야 한다 — 한 번 더 클릭하게 만들면 ⌘K 의 값이 없다.
  useEffect(() => {
    if (phase.kind === "prompt" || phase.kind === "error") inputRef.current?.focus();
  }, [phase.kind]);

  if (phase.kind === "closed") return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    // 편집기가 이 키들을 먼저 먹지 않게 한다 — 위젯은 편집면 **안**에 있다.
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      inline.discard();
    } else if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (phase.kind === "review") inline.accept();
      else void inline.submit(text);
    }
  };

  const asking = phase.kind === "prompt" || phase.kind === "error";

  return (
    <div className="code-ai" onKeyDown={onKeyDown} role="group" aria-label={t("code.ai.aria")}>
      {asking ? (
        <div className="code-ai-row">
          <Pencil size={13} className="code-ai-ico" aria-hidden />
          <input
            ref={inputRef}
            className="code-ai-input"
            value={text}
            placeholder={t("code.ai.placeholder")}
            aria-label={t("code.ai.placeholder")}
            onChange={(e) => setText(e.currentTarget.value)}
          />
          <button
            type="button"
            className="code-ai-btn primary"
            disabled={!text.trim()}
            onClick={() => void inline.submit(text)}
          >
            {t("code.ai.run")}
          </button>
        </div>
      ) : null}

      {phase.kind === "running" ? (
        <div className="code-ai-row">
          <span className="code-ai-note">{t("code.ai.running")}</span>
          <button type="button" className="code-ai-btn" onClick={inline.discard}>
            {t("common.cancel")}
          </button>
        </div>
      ) : null}

      {phase.kind === "error" ? <p className="code-ai-err">{phase.message}</p> : null}

      {phase.kind === "same" ? (
        <div className="code-ai-row">
          <span className="code-ai-note">{t("code.ai.noChange")}</span>
          <button type="button" className="code-ai-btn" onClick={inline.close}>
            {t("common.close")}
          </button>
        </div>
      ) : null}

      {phase.kind === "review" ? (
        <>
          {/* 조각이 하나면 토글 줄은 소음이다 — 받기/버리기가 곧 그 조각이다. */}
          {phase.hunks.length > 1 ? (
            <div className="code-ai-hunks" role="group" aria-label={t("code.ai.hunksAria")}>
              {phase.hunks.map((hunk, i) => {
                const stat = hunkStats(hunk);
                return (
                  <button
                    key={hunk.index}
                    type="button"
                    className={`code-ai-hunk${phase.accepted[i] ? " on" : ""}`}
                    aria-pressed={phase.accepted[i]}
                    onClick={() => inline.toggle(i)}
                  >
                    <span className="code-ai-hunk-n">{i + 1}</span>
                    <span className="code-ai-hunk-stat">
                      +{stat.added} −{stat.removed}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
          <div className="code-ai-row">
            <span className="code-ai-note">
              {t("code.ai.reviewCount", {
                taken: String(phase.accepted.filter(Boolean).length),
                total: String(phase.hunks.length),
              })}
            </span>
            <button type="button" className="code-ai-btn" onClick={inline.discard}>
              <X size={13} /> {t("code.ai.discard")}
            </button>
            <button type="button" className="code-ai-btn primary" onClick={inline.accept}>
              <Check size={13} /> {t("code.ai.accept")}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
