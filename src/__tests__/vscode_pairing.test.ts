// VS Code ↔ app (2026-11-03): the extension's "Open in Ocul" link carries a journal or plan target, and both
// ride the existing WindowNavigate.entry_path (a plan as `plan:<id>`).
import { describe, expect, it } from "vitest";
import { openNavFor, planTargetOf } from "@/features/deeplink/deepLinkPlan";

const views = ["today", "journal", "planner", "diff", "terminal"];

describe("deep link targets", () => {
  it("a journal target opens that entry", () => {
    expect(openNavFor({ view: null, journal: "20261103/Bugs/x.md" }, 3, views)).toEqual({
      view: "journal",
      project_id: 3,
      entry_path: "journal/20261103/Bugs/x.md",
    });
  });

  it("a plan target rides entry_path as plan:<id> and reads back", () => {
    const nav = openNavFor({ view: "today", plan: "direction-20261102" }, 3, views);
    expect(nav).toEqual({ view: "planner", project_id: 3, entry_path: "plan:direction-20261102" });
    expect(planTargetOf(nav.entry_path)).toBe("direction-20261102");
    expect(planTargetOf("journal/20261103/Bugs/x.md")).toBeNull();
    expect(planTargetOf("plan:")).toBeNull();
    expect(planTargetOf(null)).toBeNull();
  });

  it("without a target it is the view, as before", () => {
    expect(openNavFor({ view: "diff" }, 1, views)).toEqual({ view: "diff", project_id: 1, entry_path: null });
  });
});
