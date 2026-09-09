// 설정 화면 공용 프리미티브 — 섹션 카드·필드 행·토글·슬라이더·통계 타일.
//
// 2026-09-09 재설계에서 Tailwind 유틸리티 뭉치를 걷어내고 `.cfg-*`(settings.css)
// 로 옮겼다. 이 다섯 개가 탭 열둘의 항목 130곳을 그리므로, 여기 한 곳이
// 설정 화면 전체의 밀도·정렬·위계를 정한다.
//
// 가장 큰 변화는 `Field` 다. 예전엔 라벨을 컨트롤 **위**에 얹어(대문자 마이크로
// 라벨 + 세로 스택) 항목 하나가 두 줄을 먹었고, 컨트롤이 정렬될 축이 없어
// 스크롤하는 눈이 매번 라벨을 다시 읽어야 했다. 이제 라벨·설명은 왼쪽,
// 컨트롤은 오른쪽 한 열이다 — 여러 줄 입력만 전폭으로 떨어진다.

import { type Provider } from "@/lib/settings";

export function secretName(provider: Provider): string {
  return `${provider}_api_key`;
}

export function Section({
  title,
  children,
  description,
  tone,
}: {
  title: string;
  description?: string;
  /** 되돌릴 수 없는 것들 — 붉은 테두리 한 겹. */
  tone?: "danger";
  children: React.ReactNode;
}) {
  return (
    <section className={tone === "danger" ? "cfg-card danger" : "cfg-card"}>
      <div className="cfg-card-head">
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      {/* 직계 자식이 곧 행이다 — 탭이 넘기는 임의의 div 도 여백·구분선을 받는다. */}
      <div className="cfg-body">{children}</div>
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
  stack,
}: {
  label: string;
  hint?: string;
  /** 컨트롤을 전폭으로 — textarea 는 자동 판정되므로 그 밖의 넓은 것에만. */
  stack?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={stack ? "cfg-field stack" : "cfg-field"}>
      <div>
        <div className="cfg-field-label">{label}</div>
        {hint && <p className="cfg-field-hint">{hint}</p>}
      </div>
      <div className="cfg-field-ctl">{children}</div>
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      disabled={disabled}
      // 스위치는 상태를 **누름**으로 말한다 — role="switch" 를 쓰면 aria-checked
      // 가 필요한데, 이 버튼은 라벨 전체가 히트 영역이라 체크박스보다 토글 버튼에
      // 가깝다. (a11y 테스트가 접근 가능한 이름을 별도로 문다.)
      aria-pressed={checked}
      className="cfg-toggle"
    >
      <span className="cfg-toggle-text">
        {label}
        {hint && <p className="cfg-field-hint">{hint}</p>}
      </span>
      <span className="cfg-switch" aria-hidden="true" />
    </button>
  );
}

export function NumberSlider({
  value,
  min,
  max,
  step,
  onChange,
  onCommit,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  /**
   * 사람이 "정했다" 고 말하는 순간 (포인터·키를 놓음, 포커스 이탈).
   *
   * 슬라이더는 드래그하는 동안 프레임마다 `onChange` 를 쏜다. 그 한 프레임이
   * 곧장 SQLite 쓰기가 되면 짧은 드래그 한 번이 쓰기 20 + 창마다 전체조회가
   * 된다 (v2.42.0 `{#settings-slider}`). 부르는 쪽이 `useDeferredCommit` 으로
   * 미리보기와 커밋을 가르고, 이 콜백이 그 커밋 시점을 준다.
   */
  onCommit?: () => void;
  /** 접근 가능한 이름. 라벨은 <label for> 로 묶이지 않는 별도 div 다 —
   *  axe "Form elements must have labels" 가 여기서 걸린다. */
  ariaLabel: string;
}) {
  return (
    <div className="cfg-slider">
      <input
        type="range"
        aria-label={ariaLabel}
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit}
        onKeyUp={onCommit}
        onBlur={onCommit}
      />
      <span className="cfg-slider-value">{value}</span>
    </div>
  );
}

export function Stat({ label, value }: { label: string; value?: string }) {
  return (
    <div className="cfg-stat">
      <div className="cfg-stat-label">{label}</div>
      <div className="cfg-stat-value">{value ?? "—"}</div>
    </div>
  );
}
