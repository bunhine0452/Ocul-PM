import { describe, expect, it } from "vitest";
import { clearsContext } from "@/features/chat/conversation/permissionOptions";

// ── 계획모드 승인의 "컨텍스트 비우기" 판별 (어댑터 0.71.0) ──────────────────
//
// id 목록은 어댑터의 `PERMISSION_OPTION_ID` 상수를 그대로 옮긴 것이다.
describe("clearsContext", () => {
  it("flags every option that clears the context", () => {
    for (const id of ["exit-plan-clear-auto", "exit-plan-clear-bypass", "exit-plan-clear-accept-edits"]) {
      expect(clearsContext(id), id).toBe(true);
    }
  });

  it("does not catch the siblings that keep the context", () => {
    for (const id of ["exit-plan-auto", "exit-plan-bypass", "exit-plan-accept-edits", "exit-plan-default"]) {
      expect(clearsContext(id), id).toBe(false);
    }
  });

  it("treats every other permission option as ordinary", () => {
    for (const id of ["allow-once", "allow-with-updates", "allow-skill-exact", "reject", ""]) {
      expect(clearsContext(id), id).toBe(false);
    }
  });
});
