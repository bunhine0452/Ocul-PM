/**
 * 여럿 중 하나 — `.seg` 한 물체를 **라디오 묶음**으로 (11-15). `role="tab"` 이던 세그먼트는 딸린 탭
 * 패널이 없어 화면 읽기 프로그램에 「탭」 이라고 거짓말을 했고, 방향키도 듣지 않았다. 고른 것만 Tab
 * 으로 닿고(roving tabindex), ←→ 로 옮기면서 고른다. 지금 값이 목록에 없으면 아무것도 고르지 않고
 * 첫 칸이 Tab 자리다.
 *
 * 둘 중 하나 · 여럿 중 하나는 화면마다 이것 하나다 (11-15 RC-19) — 오늘의 「계획별/시간순」(눌린 단추 둘) ·
 * 일지 머리(이것을 다시 짠 지역 라디오) · 나란히 시작의 개수(탭)가 저마다였다. 지금은 못 고르는 칸은
 * `blockedReason` 으로 막는다 — 포커스는 남아 이유가 읽히고(`blocked`), 방향키는 그 칸을 건너뛴다. 방향키는
 * 여기서 멈춘다 — 화면 컨테이너의 ↑↓(목록 이동)까지 내려가지 않게.
 */
import { useRef, type KeyboardEvent, type ReactNode } from "react";

import { blocked } from "@/lib/blocked";

export interface RadioSegOption<T extends string> {
  id: T;
  label: ReactNode;
  /** 이름이 글이 아닐 때(숫자를 덧붙였을 때) 읽어 줄 이름. */
  aria?: string;
  /** 지금은 고를 수 없는 이유 — 있으면 칸은 살아 있되 고르지 않는다. */
  blockedReason?: string | null;
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
    e.stopPropagation();
    // 막힌 칸은 건너뛴다 — 다 막혔으면 그대로.
    let next = at < 0 ? 0 : at;
    for (let i = 0; i < options.length; i++) {
      next = (next + step + options.length) % options.length;
      if (!options[next].blockedReason) break;
    }
    if (options[next].blockedReason) return;
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
          {...blocked(o.blockedReason ?? null)}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
