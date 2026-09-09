import { describe, expect, it, vi } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { blocked } from "@/lib/blocked";
import { ROOT, walk } from "./designFs";

// {#fix-disabled-reason} (2026-09-10) — 감사의 처방(title·aria-describedby)은
// `disabled` 요소가 마우스도 포커스도 안 받아 **둘 다 사용자에게 도달하지
// 않는다**. 그래서 요소를 살려 두고(aria-disabled) 클릭만 막는다. 여기서
// 지키는 것은 그 계약이다.
describe("blocked()", () => {
  it("이유가 없으면 비활성 신호를 만들지 않는다", () => {
    expect(blocked(null)).toEqual({});
    expect(blocked(undefined)).toEqual({});
    expect(blocked("")).toEqual({});
  });

  it("이유가 없고 평소 툴팁만 있으면 툴팁만 준다", () => {
    expect(blocked(null, "무엇을 하는 버튼인지")).toEqual({ title: "무엇을 하는 버튼인지" });
  });

  it("막히면 이유가 툴팁을 **이긴다** — 같은 자리를 두고 다투는 다른 문장이다", () => {
    const props = blocked("프로젝트를 먼저 고르세요", "무엇을 하는 버튼인지");
    expect(props).toMatchObject({ "aria-disabled": true, title: "프로젝트를 먼저 고르세요" });
  });

  it("`disabled` 를 내보내지 않는다 — 그걸 쓰면 이유가 다시 도달하지 않는다", () => {
    expect(blocked("이유")).not.toHaveProperty("disabled");
  });

  it("클릭을 capture 단계에서 막는다 — 조상의 위임 핸들러까지", () => {
    const props = blocked("이유");
    expect("onClickCapture" in props).toBe(true);
    const e = { preventDefault: vi.fn(), stopPropagation: vi.fn() };
    (props as { onClickCapture: (e: unknown) => void }).onClickCapture(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(e.stopPropagation).toHaveBeenCalled();
  });
});

// ─── 이유 없는 비활성 — 래칫 ────────────────────────────────────────────────
//
// 실측 131곳. 감사는 35곳이라 했는데 그건 `title`·`aria-describedby` 가 없는
// 것만 센 수이고, 있던 16곳도 전부 **아이콘 버튼의 이름**(이름 바꾸기·삭제·
// 위로)이지 막힌 이유가 아니었다 — 이유를 말하는 곳은 처음부터 0 이었다.
//
// 진행 중(busy·saving·loading)은 세지 않는다: 스스로 설명되고 곧 풀리므로
// 사용자가 물을 것이 없다. 조건이 안 맞아 막힌 것만이 "무엇을 고쳐야 하나" 를
// 남긴다.
//
// 줄이면 이 숫자를 내려 적을 것. 새 비활성은 `blocked()` 를 거치거나
// (lib/blocked.ts) `AutomationEditor` 처럼 곁에 보이는 문장을 두는 쪽이다.
describe("이유 없는 비활성 (래칫)", () => {
  const BUSY = /^!?\w*(?:busy|loading|saving|pending|running|sending|submitting|inflight|working)\w*$/i;

  it("이유 없이 막는 버튼이 **늘지** 않는다", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT))) {
      if (!/\.tsx$/.test(file)) continue;
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/disabled=\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/g)) {
        const parts = m[1].split(/\|\||&&/).map((p) => p.trim());
        if (parts.every((p) => BUSY.test(p))) continue;
        offenders.push(`${file.slice(ROOT.length + 1)}:${src.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(offenders.length, `이유 없는 비활성 ${offenders.length}곳`).toBeLessThanOrEqual(129);
  });
});
