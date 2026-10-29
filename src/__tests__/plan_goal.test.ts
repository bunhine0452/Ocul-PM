// 계획의 「끝까지」를 /goal 로 (ocul-next #goal) — 조건은 계획 파일의 완료 조건 · 확인 명령 그대로.
import { describe, expect, it } from "vitest";

import { GOAL_MAX_CHARS, goalCommand } from "@/features/planner/goal";
import { t } from "@/i18n";

describe("/goal 조건", () => {
  it("완료 조건과 확인 명령을 둘 다, 하나만 있으면 그 하나로, 둘 다 없으면 없다", () => {
    expect(goalCommand(t, "p", "앱이 다섯 화면만 남는다", "pnpm test")).toBe(
      `/goal ${t("plan.goal.both", { plan: ".oculpm/planner/p.md", doneWhen: "앱이 다섯 화면만 남는다", check: "pnpm test" })}`,
    );
    expect(goalCommand(t, "p", "다섯 화면", null)).toContain("다섯 화면");
    expect(goalCommand(t, "p", null, "pnpm test")).toContain("`pnpm test`");
    expect(goalCommand(t, "p", "  ", null)).toBeNull();
    expect(goalCommand(t, "p", null, null)).toBeNull();
  });

  it("줄바꿈은 한 줄로 펴고, 길면 완료 조건부터 줄여 4000자 안 — 확인 명령은 자르지 않는다", () => {
    const check = "pnpm typecheck && pnpm test && pnpm lint && pnpm build";
    const goal = goalCommand(t, "p", `${"긴 조건 ".repeat(800)}\n끝`, check)!;
    expect(goal.length - "/goal ".length).toBeLessThanOrEqual(GOAL_MAX_CHARS);
    expect(goal).toContain(check);
    expect(goal).toContain("…");
    expect(goal).not.toContain("\n");
  });
});
