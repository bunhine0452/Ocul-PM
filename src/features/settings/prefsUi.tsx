/**
 * 설정 한 쪽의 조각 셋 — 칸(카드) · 줄(라벨 왼쪽, 값 오른쪽) · 고르기(세그먼트).
 * 네 칸이 같은 모양으로 서도록 한 곳에 둔다.
 */
import type { ReactNode } from "react";

export function PrefsCard({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  children: ReactNode;
}) {
  const titleId = `${id}-title`;
  return (
    <section id={id} className="card prefs-card" aria-labelledby={titleId}>
      <div className="prefs-head">
        <h2 id={titleId}>{title}</h2>
        {note ? <span className="prefs-note">{note}</span> : null}
      </div>
      {children}
    </section>
  );
}

export function PrefsRow({ label, meta, children }: { label: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <div className="prefs-row">
      <div className="prefs-label">
        <div className="prefs-name">{label}</div>
        {meta ? <div className="prefs-meta">{meta}</div> : null}
      </div>
      <div className="prefs-val">{children}</div>
    </div>
  );
}

/** 여럿 중 하나 — `.seg` 한 물체 (게이트 규칙 21). 지금 값이 목록에 없으면 아무것도 안 고른다. */
export function PrefsSeg<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | null;
  options: ReadonlyArray<{ id: T; label: string }>;
  onChange: (next: T) => void;
}) {
  return (
    <div className="seg" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="tab"
          aria-selected={value === o.id}
          className="seg-item"
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
