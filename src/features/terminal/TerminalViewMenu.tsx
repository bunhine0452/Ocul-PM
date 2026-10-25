import { useCallback, useRef, useState } from "react";
import { useT } from "@/i18n";
import { useDismiss } from "@/features/chat/useDismiss";
import { TERM_DENSITIES, TERM_DENSITY_LABEL, type TermDensity } from "./density";
import { TERM_FONT_MIN as FONT_MIN, TERM_FONT_MAX as FONT_MAX } from "./fontSize";
import type { TerminalFont } from "./useTerminalFont";

// 보기 메뉴 `Aa` — 글자 크기와 줄 간격 (2026-10-25, 시안 A).
//
// 둘 다 예전에는 상태바에 상시로 떠 있었다. 하루에 한 번 만질까 말까 한 조작이
// 가장 눈에 띄는 줄을 차지하고, 좁은 도크에서는 작업 폴더를 밀어냈다. 이제
// 머리줄의 버튼 하나 뒤에 접어 둔다 — ⌘+/⌘−/⇧⌘0 은 그대로 산다.

interface TerminalViewMenuProps {
  font: TerminalFont;
  density: TermDensity;
  onDensity: (d: TermDensity) => void;
}

export function TerminalViewMenu({ font, density, onDensity }: TerminalViewMenuProps) {
  const { t } = useT();
  // 열린 자리 — 버튼 아래에 화면 기준(fixed)으로 띄운다. 화면 툴바의 액션 묶음은
  // 좁은 창에서 가로 스크롤로 도망가는 상자라(`.toolbar-actions`), 그 안에 절대
  // 위치로 띄우면 팝오버가 상자 경계에서 잘린다.
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const open = pos !== null;
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setPos(null), []);
  useDismiss(open, ref, close);
  const { fontSize, fontDraft, setFontDraft, setFont, fontDelta, commitFontDraft } = font;

  return (
    <div className="term-view" ref={ref}>
      <button
        type="button"
        className="term-tool term-view-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("term.view.label")}
        title={t("term.view.label")}
        onClick={(e) => {
          if (open) return close();
          const r = e.currentTarget.getBoundingClientRect();
          setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
        }}
      >
        Aa
      </button>
      {pos ? (
        <div
          className="term-view-pop"
          role="dialog"
          aria-label={t("term.view.label")}
          style={{ top: pos.top, right: pos.right }}
        >
          <div className="tvp-row">
            <span className="tvp-label">{t("term.view.font")}</span>
            <div className="tvp-font">
              <button type="button" className="tvp-btn" onClick={() => fontDelta(-1)} aria-label={t("term.fontSmaller")}>
                A−
              </button>
              <span className="tvp-size">
                <input
                  type="number"
                  className="tvp-input"
                  min={FONT_MIN}
                  max={FONT_MAX}
                  step={1}
                  value={fontDraft ?? String(fontSize)}
                  aria-label={t("term.fontSizeInput")}
                  title={t("term.fontSizeHint", { min: FONT_MIN, max: FONT_MAX })}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setFontDraft(raw);
                    // 범위 안 값만 즉시 반영 — "1"(→18 을 치는 중)이 9 로 튀지 않게.
                    const parsed = Number.parseInt(raw, 10);
                    if (parsed >= FONT_MIN && parsed <= FONT_MAX) setFont(parsed);
                  }}
                  onBlur={commitFontDraft}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitFontDraft();
                    } else if (e.key === "Escape") {
                      setFontDraft(null);
                    }
                  }}
                />
                px
              </span>
              <button type="button" className="tvp-btn" onClick={() => fontDelta(1)} aria-label={t("term.fontLarger")}>
                A+
              </button>
            </div>
          </div>
          <div className="tvp-row">
            <span className="tvp-label">{t("term.density.label")}</span>
            <span className="seg tvp-density" role="group" aria-label={t("term.density.label")} title={t("term.density.hint")}>
              {TERM_DENSITIES.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  className="seg-item"
                  aria-selected={preset === density}
                  onClick={() => onDensity(preset)}
                >
                  {t(TERM_DENSITY_LABEL[preset])}
                </button>
              ))}
            </span>
          </div>
          <span className="tvp-hint">{t("term.view.resetHint")}</span>
        </div>
      ) : null}
    </div>
  );
}
