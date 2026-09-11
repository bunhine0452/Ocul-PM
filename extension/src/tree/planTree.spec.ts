import { describe, expect, it } from "vitest";
import { buildOpenDeepLink } from "../deeplink";
import type { PlanItem } from "../oculpm/planner";
import { checkboxFor, progressOf, STATUS_ICON } from "./planModel";

const item = (id: string, status: PlanItem["status"], parent?: string): PlanItem =>
  ({ itemId: id, title: id, status, orderIdx: 0, parentItem: parent });

describe("progressOf — 리프만 세고 dropped 는 모수에서 뺀다", () => {
  it("부모는 롤업이라 안 센다", () => {
    const p = progressOf([item("a", "done"), item("p", "in_progress"), item("c1", "done", "p"), item("c2", "todo", "p"), item("z", "dropped")]);
    expect(p).toEqual({ done: 2, total: 3 });
  });
  it("6종 상태 전부 아이콘이 있다", () => {
    expect(Object.keys(STATUS_ICON).sort()).toEqual(["blocked", "deferred", "done", "dropped", "in_progress", "todo"]);
  });
});

describe("buildOpenDeepLink", () => {
  it("공백은 + 가 아니라 %20 — 앱의 percent_decode 는 + 를 공백으로 안 되돌린다", () => {
    expect(buildOpenDeepLink("/Users/me/한 프로젝트", "/Users/me/한 프로젝트/.oculpm/journal/20260911/Chores/1_chore_x.md")).toBe(
      "oculpm://open?project=%2FUsers%2Fme%2F%ED%95%9C%20%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8&view=journal&entry=%2FUsers%2Fme%2F%ED%95%9C%20%ED%94%84%EB%A1%9C%EC%A0%9D%ED%8A%B8%2F.oculpm%2Fjournal%2F20260911%2FChores%2F1_chore_x.md",
    );
    expect(buildOpenDeepLink("/p")).toBe("oculpm://open?project=%2Fp&view=journal");
  });
});

describe("checkboxFor — 리프·활성·쓰기 가능일 때만", () => {
  const plan = (status: string, items: PlanItem[]) => ({ status, items });
  it("잠긴 플랜은 체크박스가 없다", () => {
    const a = item("a", "todo");
    expect(checkboxFor(a, plan("done", [a]), false)).toMatchObject({ kind: "none", reason: expect.stringContaining("잠긴") });
    expect(checkboxFor(a, plan("archived", [a]), false).kind).toBe("none");
  });
  it("부모는 롤업이라 없고, 읽기 전용이면 이유가 붙고, 리프는 done 여부로 체크", () => {
    const p = item("p", "in_progress");
    const c = item("c", "done", "p");
    expect(checkboxFor(p, plan("active", [p, c]), false)).toMatchObject({ kind: "none", reason: expect.stringContaining("롤업") });
    expect(checkboxFor(c, plan("active", [p, c]), true)).toMatchObject({ kind: "none", reason: expect.stringContaining("읽기 전용") });
    expect(checkboxFor(c, plan("active", [p, c]), false)).toEqual({ kind: "checkbox", checked: true });
    expect(checkboxFor(item("t", "blocked"), plan("active", []), false)).toEqual({ kind: "checkbox", checked: false });
  });
});
