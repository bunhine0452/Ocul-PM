/**
 * 여럿 중 하나 — `.seg` 한 물체를 **라디오 묶음**으로 (11-15). `role="tab"` 이던 세그먼트는 딸린 탭
 * 패널이 없어 화면 읽기 프로그램에 「탭」 이라고 거짓말을 했고, 방향키도 듣지 않았다. 고른 것만 Tab
 * 으로 닿고(roving tabindex), ←→ 로 옮기면서 고른다. 지금 값이 목록에 없으면 아무것도 고르지 않고
 * 첫 칸이 Tab 자리다.
 */
import { useRef, type KeyboardEvent, type ReactNode } from "react";

export interface RadioSegOption<T extends string> {
  id: T;
  label: ReactNode;
  /** 이름이 글이 아닐 때(숫자를 덧붙였을 때) 읽어 줄 이름. */
  aria?: string;
}

export function RadioSeg<T extends string>({
  label,
  value,
  options,
  onChange,
  title,
}: {
  label: string;
  value: T | null;
  options: ReadonlyArray<RadioSegOption<T>>;
  onChange: (next: T) => void;
  title?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const at = options.findIndex((o) => o.id === value);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step || options.length === 0) return;
    e.preventDefault();
    const next = ((at < 0 ? 0 : at) + step + options.length) % options.length;
    onChange(options[next].id);
    refs.current[next]?.focus();
  };
  return (
    <div className="seg" role="radiogroup" aria-label={label} title={title} onKeyDown={onKeyDown}>
      {options.map((o, i) => (
        <button
          key={o.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          aria-label={o.aria}
          tabIndex={i === (at < 0 ? 0 : at) ? 0 : -1}
          className="seg-item"
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
