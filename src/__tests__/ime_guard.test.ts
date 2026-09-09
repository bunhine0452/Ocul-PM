import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { isImeComposing } from "@/lib/ime";
import { ROOT, walk } from "./designFs";

// {#unify-chat} (2026-09-10) — 이 판정이 앱에 네 벌 있었고 셋은 두 조건만
// 알고 있었다. `key === "Process"` 는 터미널(imeBridge)만 알던 것인데, 그 화면이
// IME 버그로 제일 많이 데인 자리라서였다. 판정이 흩어져 있으면 배운 것이 안 퍼진다.
describe("isImeComposing", () => {
  const base = { isComposing: false, keyCode: 0, key: "Enter" };

  it("조합 중이 아니면 거짓", () => {
    expect(isImeComposing(base)).toBe(false);
    expect(isImeComposing({ nativeEvent: base })).toBe(false);
  });

  it("세 신호를 모두 본다 — 하나라도 참이면 조합 중", () => {
    expect(isImeComposing({ ...base, isComposing: true })).toBe(true);
    expect(isImeComposing({ ...base, keyCode: 229 })).toBe(true);
    expect(isImeComposing({ ...base, key: "Process" })).toBe(true);
  });

  it("React 합성 이벤트도 받는다 — 호출부에 둘 다 있다", () => {
    expect(isImeComposing({ nativeEvent: { ...base, keyCode: 229 } })).toBe(true);
    expect(isImeComposing({ nativeEvent: { ...base, key: "Process" } })).toBe(true);
  });

  it("손으로 쓴 IME 가드가 남아 있지 않다", () => {
    const offenders: string[] = [];
    for (const file of walk(join(ROOT))) {
      if (file.endsWith("lib/ime.ts")) continue;
      const src = readFileSync(file, "utf8");
      src.split("\n").forEach((line, i) => {
        if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) return;
        if (/\bisComposing\b/.test(line) && /229|"Process"/.test(line)) {
          offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1}`);
        }
      });
    }
    expect(offenders, `손으로 쓴 IME 가드: ${offenders.join(" · ")}`).toEqual([]);
  });
});
