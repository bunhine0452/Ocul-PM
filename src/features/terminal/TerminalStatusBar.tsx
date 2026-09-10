import { SquareTerminal } from "@/components/Icons";
import { useT } from "@/i18n";
import { TERM_DENSITIES, TERM_DENSITY_LABEL, type TermDensity } from "./density";
import { TERM_FONT_MIN as FONT_MIN, TERM_FONT_MAX as FONT_MAX } from "./fontSize";

// 하단 상태바 (TerminalSurface 에서 분리, 2026-09-11 리디자인 2차).
//
// 왼쪽은 **어디에 있는가**(포커스 페인의 작업 폴더), 가운데는 손이 가장 자주
// 가는 네 단축키를 키캡으로, 오른쪽은 밀도(세그먼트)·글자 크기(스테퍼)·
// .oculpm 감시 상태다. 예전에는 단축키 일곱 개를 한 문장으로 적어 두었는데,
// 줄이 좁아지면 그 문장부터 잘려 아무것도 읽히지 않았다. 전체 목록은 키캡
// 묶음의 툴팁에 남긴다.

interface TerminalStatusBarProps {
  compact: boolean;
  crumb: string;
  crumbTitle: string | undefined;
  density: TermDensity;
  onDensity: (d: TermDensity) => void;
  fontSize: number;
  fontDraft: string | null;
  setFontDraft: (v: string | null) => void;
  setFont: (px: number) => void;
  fontDelta: (d: number) => void;
  commitFontDraft: () => void;
  watchColor: string;
  watchLabel: string;
}

export function TerminalStatusBar({
  compact,
  crumb,
  crumbTitle,
  density,
  onDensity,
  fontSize,
  fontDraft,
  setFontDraft,
  setFont,
  fontDelta,
  commitFontDraft,
  watchColor,
  watchLabel,
}: TerminalStatusBarProps) {
  const { t } = useT();
  const keys: Array<[string, string]> = [
    ["⌘D", t("term.kbd.split")],
    ["⌘F", t("term.kbd.find")],
    ["⇧⌘↩", t("term.kbd.zoom")],
    ["⌘↑↓", t("term.kbd.blocks")],
  ];
  return (
    <div className="term-status">
      <span className="ts-seg ts-crumb" title={crumbTitle}>
        <SquareTerminal size={13} />
        <span className="ts-crumb-text">{crumb}</span>
      </span>
      {/* 좁은 도크에서는 키캡이 다른 정보를 밀어낸다 — 넓을 때만. */}
      {compact ? null : (
        <span className="ts-keys" title={`${t("term.kbd.all")}: ${t("term.shortcuts")}`}>
          {keys.map(([cap, label]) => (
            <span className="ts-key" key={cap}>
              <kbd className="kbd">{cap}</kbd>
              <span className="ts-key-label">{label}</span>
            </span>
          ))}
        </span>
      )}
      <span style={{ flex: 1 }} />
      <span className="seg ts-density" role="group" aria-label={t("term.density.label")} title={t("term.density.hint")}>
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
      <span className="ts-seg ts-fontctl">
        <button type="button" className="ts-btn" onClick={() => fontDelta(-1)} aria-label={t("term.fontSmaller")}>
          A−
        </button>
        <span className="ts-font">
          <input
            type="number"
            className="ts-font-input"
            min={FONT_MIN}
            max={FONT_MAX}
            step={1}
            value={fontDraft ?? String(fontSize)}
            aria-label={t("term.fontSizeInput")}
            title={t("term.fontSizeHint", { min: FONT_MIN, max: FONT_MAX })}
            onChange={(e) => {
              const raw = e.target.value;
              setFontDraft(raw);
              // 범위 안 값만 즉시 반영 — "1"(→18 을 치는 중)이 9 로 튀지 않게
              // 클램프 없이 통과시킨다. 범위 밖·빈 값은 blur 에서 정리.
              const parsed = Number.parseInt(raw, 10);
              if (parsed >= FONT_MIN && parsed <= FONT_MAX) setFont(parsed);
            }}
            onBlur={commitFontDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitFontDraft();
                e.currentTarget.blur();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setFontDraft(null);
                e.currentTarget.blur();
              }
            }}
          />
          px
        </span>
        <button type="button" className="ts-btn" onClick={() => fontDelta(1)} aria-label={t("term.fontLarger")}>
          A+
        </button>
      </span>
      {compact ? null : (
        <span className="ts-seg ts-watch">
          <span className="ts-dot" style={{ background: watchColor }} />
          {watchLabel}
        </span>
      )}
    </div>
  );
}
