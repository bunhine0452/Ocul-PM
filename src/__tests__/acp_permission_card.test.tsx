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

// ── 셸 승인의 제목 (어댑터 0.81.0) ──────────────────────────────────────────
//
// 어댑터가 Bash 승인의 제목을 Claude 의 한 줄 설명에서 **명령 원문**으로 바꿨다.
// 그 원문은 IN 블록에 이미 있으므로 제목에서 또 굵게 그리면 같은 글이 두 번이다.

describe("PermissionCard — shell approval title", () => {
  const OPTIONS: PermissionState["options"] = [
    { id: "allow-once", name: "Yes", option_kind: "allow_once" },
    { id: "reject", name: "No", option_kind: "reject_once" },
  ];
  const shell = (title: string, input: string | null): PermissionState => ({
    ...permission(OPTIONS),
    title,
    tool_kind: "execute",
    input,
  });
  const titleText = () => document.querySelector(".perm-title")?.textContent;

  it("labels the card instead of repeating the command shown in IN", () => {
    const command = "rm -rf dist &&\n  pnpm build";
    render(<PermissionCard request={shell(command, command)} onDecide={() => {}} />);

    expect(titleText()).toBe("명령"); // i18n-ignore -- 사전 문구 조회
    expect(document.querySelector(".perm-payload pre")?.textContent).toBe(command);
  });

  it("treats a truncated IN as the same command", () => {
    const command = "echo " + "x".repeat(40);
    const clamped = command.slice(0, 20) + "\n… (truncated)";
    render(<PermissionCard request={shell(command, clamped)} onDecide={() => {}} />);

    expect(titleText()).toBe("명령"); // i18n-ignore -- 사전 문구 조회
  });

  it("keeps a title that says something the command does not", () => {
    // 옛 어댑터(≤0.77.0)의 한 줄 설명은 그대로 제목이다.
    render(<PermissionCard request={shell("Run the tests", "pnpm test")} onDecide={() => {}} />);

    expect(titleText()).toBe("Run the tests");
  });
});
