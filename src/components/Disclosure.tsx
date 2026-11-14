import { useId, useState, type ReactNode, type Ref } from "react";

import { ChevronRight } from "@/components/Icons";
import "./disclosure.css";

/**
 * 접기 손잡이 하나 (11-15) — 꺾쇠 11 · 이름 · 숫자(tabular) · 가리키면 면 · 안쪽 포커스 링 · 다시 누르면 접힘.
 *
 * 일지 · 계획 두 화면에 접는 자리가 다섯(사라진 코드의 일지 · 끝난 계획 · 계획 기록 · 닫힌 계획의 미완 ·
 * 끝난 단계)이었고 손잡이 모양도 다섯이었다 — `<details>` 셋 · 단추 하나 · 가로로 흐르는 단추 줄 하나.
 * 같은 뜻은 같은 모양이다(영수증 규칙 4). 접힌 것은 숫자로 말한다(규칙 5) — `count` 가 그 자리다.
 *
 * `<details>` 가 아니라 단추 + `aria-expanded` 다: 펼침 상태가 DOM 속성으로 서야 화면 시험이 물 수 있고,
 * 열림을 부모가 쥘 수 있어야(제어형) 「선택이 나가도 사람이 연 접힘은 열린 채」 를 지킨다.
 */
export function Disclosure({
  label,
  count,
  open: openProp,
  defaultOpen = false,
  onToggle,
  title,
  className,
  headRef,
  children,
}: {
  /** 머리의 이름. */
  label: ReactNode;
  /** 이름 뒤의 수 — 접힌 것이 몇인지. */
  count?: ReactNode;
  /** 제어형 열림. 주지 않으면 스스로 쥔다(`defaultOpen`). */
  open?: boolean;
  defaultOpen?: boolean;
  onToggle?: (open: boolean) => void;
  title?: string;
  /** 바깥 상자의 클래스 — 자리마다 여백만 다르다. */
  className?: string;
  /** 머리 단추 — 펼친 뒤 포커스를 둘 곳. */
  headRef?: Ref<HTMLButtonElement>;
  children: ReactNode;
}) {
  const [own, setOwn] = useState(defaultOpen);
  const open = openProp ?? own;
  const bodyId = useId();
  const toggle = () => {
    const next = !open;
    if (openProp === undefined) setOwn(next);
    onToggle?.(next);
  };
  return (
    <div className={"disc" + (className ? ` ${className}` : "")} data-open={open || undefined}>
      <button
        ref={headRef}
        type="button"
        className="disc-h"
        aria-expanded={open}
        aria-controls={open ? bodyId : undefined}
        title={title}
        onClick={toggle}
      >
        <ChevronRight size={11} className="disc-chev" aria-hidden="true" />
        <span className="disc-name">{label}</span>
        {/* 빈칸 글자 하나 — flex 배치에선 사라지고, 읽는 이름은 「이름 3」 으로 띄어진다. */}
        {count != null ? (
          <>
            {" "}
            <span className="disc-n">{count}</span>
          </>
        ) : null}
      </button>
      {open ? (
        <div id={bodyId} className="disc-body">
          {children}
        </div>
      ) : null}
    </div>
  );
}
