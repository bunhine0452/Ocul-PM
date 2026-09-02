import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { PermissionCard } from "@/features/chat/conversation/PermissionCard";
import type { AcpEvent } from "@/lib/bindings";

type PermissionState = Extract<AcpEvent, { kind: "permission" }>;

// ── 계획모드 승인 카드 (어댑터 0.71.0) ──────────────────────────────────────
//
// 어댑터가 ExitPlanMode 승인에 "컨텍스트를 비우고 이어가기"를 더했다. 허용
// 계열이라 아무것도 안 하면 옆의 "그냥 허용"과 **같은 버튼**으로 보이는데,
// 실제로는 이 대화가 사라진다. 카드가 그 차이를 보이는지 붙잡아 둔다.

afterEach(cleanup);

function permission(options: PermissionState["options"]): PermissionState {
  return {
    kind: "permission",
    request_id: "req-1",
    title: "Ready to code?",
    tool_kind: "switch_mode",
    locations: [],
    options,
    diffs: [],
    input: null,
  };
}

const EXIT_PLAN: PermissionState["options"] = [
  { id: "exit-plan-clear-auto", name: "Yes, clear context (37% used) and use auto mode", option_kind: "allow_always" },
  { id: "exit-plan-auto", name: "Yes, and use auto mode", option_kind: "allow_always" },
  { id: "exit-plan-default", name: "Yes, manually approve edits", option_kind: "allow_once" },
  { id: "reject", name: "No, keep planning", option_kind: "reject_once" },
];

describe("PermissionCard — the option that clears the context", () => {
  it("gives only the clearing option the warning face", () => {
    render(<PermissionCard request={permission(EXIT_PLAN)} onDecide={() => {}} />);

    const clear = screen.getByRole("button", { name: /clear context/i });
    expect(clear.className).toContain("perm-destructive");
    expect(clear.className).not.toContain("perm-always");

    // 같은 allow_always 인 형제는 원래 낯빛 그대로여야 구분이 선다.
    const plain = screen.getByRole("button", { name: "Yes, and use auto mode" });
    expect(plain.className).toContain("perm-always");
    expect(plain.className).not.toContain("perm-destructive");
  });

  it("says what disappears above the buttons, not below", () => {
    render(<PermissionCard request={permission(EXIT_PLAN)} onDecide={() => {}} />);

    const note = screen.getByText(/되돌릴 수 없어요/); // i18n-ignore -- 사전 문구 조회
    const actions = note.parentElement?.querySelector(".perm-actions");
    expect(actions).not.toBeNull();
    // DOM 순서상 설명이 먼저 — 누르기 전에 읽힌다.
    expect(note.compareDocumentPosition(actions!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("leaves an ordinary approval card untouched", () => {
    render(
      <PermissionCard
        request={permission([
          { id: "allow-once", name: "Yes", option_kind: "allow_once" },
          { id: "reject", name: "No", option_kind: "reject_once" },
        ])}
        onDecide={() => {}}
      />,
    );

    expect(screen.queryByText(/되돌릴 수 없어요/)).toBeNull(); // i18n-ignore -- 사전 문구 조회
    expect(screen.getByRole("button", { name: "Yes" }).className).not.toContain("perm-destructive");
  });
});
