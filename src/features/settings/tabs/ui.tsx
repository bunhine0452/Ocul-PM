// 설정 화면 공용 프리미티브 — 섹션·필드·토글·슬라이더·통계 표시.
//
// SettingsPanel.tsx 에서 갈라 나온 조각이다 — 순수 이동이며 동작 변경은 없다.

import { Label } from "@/components/ui/label";
import { type Provider } from "@/lib/settings";

export function secretName(provider: Provider): string {
  return `${provider}_api_key`;
}

export function Section({
  title,
  children,
  description,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3 py-5 first:pt-0 border-b border-border/60 last:border-b-0 last:pb-0">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[11px] uppercase text-muted-foreground tracking-wider">
        {label}
      </Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground/80">{hint}</p>}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-border bg-background hover:bg-accent/30 transition-colors cursor-pointer"
    >
      <span className="text-sm text-foreground">{label}</span>
      <span
        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
          checked ? "bg-primary" : "bg-muted"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            checked ? "translate-x-4" : "translate-x-0.5"
          }`}
        />
      </span>
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
  /** 접근 가능한 이름. `Field` 의 <Label> 은 htmlFor 가 없어 연결되지 않는다 —
   *  axe "Form elements must have labels" 가 여기서 걸린다. */
  ariaLabel: string;
}) {
  return (
    <div className="flex items-center gap-3">
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
        className="flex-1 accent-[color:var(--primary)]"
      />
      <span className="text-xs text-foreground font-mono tabular-nums w-12 text-right">
        {value}
      </span>
    </div>
  );
}

export function Stat({ label, value }: { label: string; value?: string }) {
  return (
    <div className="p-3 bg-secondary/40 rounded-xl">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-bold mt-0.5">{value ?? "—"}</div>
    </div>
  );
}
