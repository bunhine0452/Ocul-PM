import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor, within } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

// ─── PR-R1 (A3) — AI 대화 기록 ────────────────────────────────────────────
//
// ConversationHistoryModal is the data UI behind the AI 패널's "대화 기록"
// button (formerly disabled "1.1"). It's stream-free so it unit-tests cleanly
// under jsdom with mocked conversation_* commands (§0.11's AI runtime limit is
// about xterm/streaming, not this list).

const summarize = (r: AxeResults) =>
  r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));

const AXE_OPTIONS = {
  rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
} as const;

function conv(over: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1,
    title: "대화",
    provider: "anthropic",
    model: null,
    project_id: 1,
    created_at: 1000,
    updated_at: 1000,
    last_message_at: 2000,
    ...over,
  };
}

const convFx: { list: unknown[] } = { list: [] };
const deleteMock: { calls: number[] } = { calls: [] };

vi.mock("@/lib/bindings", () => ({
  commands: {
    conversationList: () => Promise.resolve({ status: "ok", data: convFx.list }),
    conversationDelete: (id: number) => {
      deleteMock.calls.push(id);
      return Promise.resolve({ status: "ok", data: null });
    },
  },
}));

import { ConversationHistoryModal } from "@/features/chat/ConversationHistoryModal";

function renderModal(over: Partial<React.ComponentProps<typeof ConversationHistoryModal>> = {}) {
  const onSelect = vi.fn();
  const onNew = vi.fn();
  const onActiveDeleted = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <ConversationHistoryModal
      projectId={1}
      activeId={1}
      onSelect={onSelect}
      onNew={onNew}
      onActiveDeleted={onActiveDeleted}
      onClose={onClose}
      {...over}
    />,
  );
  return { ...utils, onSelect, onNew, onActiveDeleted, onClose };
}

beforeEach(() => {
  convFx.list = [];
  deleteMock.calls = [];
});
afterEach(() => cleanup());

describe("PR-R1 (A3) — 대화 기록 모달", () => {
  it("대화 목록을 렌더하고 활성 대화를 강조한다", async () => {
    convFx.list = [
      conv({ id: 1, title: "첫 대화" }),
      conv({ id: 2, title: "둘째 대화", last_message_at: 1000 }),
    ];
    const { findByText, container } = renderModal({ activeId: 2 });
    expect(await findByText("첫 대화")).toBeInTheDocument();
    expect(await findByText("둘째 대화")).toBeInTheDocument();
    // 활성(id=2) 행이 .active
    const active = container.querySelector(".conv-row.active");
    expect(active?.textContent).toContain("둘째 대화");
  });

  it("행 클릭 → onSelect(id)", async () => {
    convFx.list = [conv({ id: 7, title: "열어볼 대화" })];
    const { findByText, onSelect } = renderModal();
    fireEvent.click(await findByText("열어볼 대화"));
    expect(onSelect).toHaveBeenCalledWith(7);
  });

  it("'새 대화' → onNew", async () => {
    convFx.list = [conv({ id: 1, title: "기존" })];
    const { findByText, getByText, onNew } = renderModal();
    await findByText("기존");
    fireEvent.click(getByText("새 대화"));
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it("활성 대화 삭제 → 확인 다이얼로그 → conversationDelete + onActiveDeleted", async () => {
    convFx.list = [conv({ id: 5, title: "지울 대화" })];
    const { findByLabelText, findByRole, onActiveDeleted } = renderModal({ activeId: 5 });
    fireEvent.click(await findByLabelText("지울 대화 삭제"));
    // 확인 없이 지워지던 것이 2026-08-30 에 useConfirm 으로 바뀌었다 — 다이얼로그의
    // 「삭제」 를 눌러야 실제 삭제가 돈다.
    expect(deleteMock.calls).not.toContain(5);
    const dialog = await findByRole("dialog", { name: /이 대화를 삭제할까요/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "삭제" }));
    await waitFor(() => expect(deleteMock.calls).toContain(5));
    await waitFor(() => expect(onActiveDeleted).toHaveBeenCalledTimes(1));
  });

  it("활성 대화 삭제 취소 → 아무것도 지우지 않는다", async () => {
    convFx.list = [conv({ id: 5, title: "지울 대화" })];
    const { findByLabelText, findByRole } = renderModal({ activeId: 5 });
    fireEvent.click(await findByLabelText("지울 대화 삭제"));
    const dialog = await findByRole("dialog", { name: /이 대화를 삭제할까요/ });
    fireEvent.click(within(dialog).getByRole("button", { name: "취소" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    expect(deleteMock.calls).not.toContain(5);
  });

  it("빈 목록 → 안내 힌트", async () => {
    convFx.list = [];
    const { findByText } = renderModal();
    expect(await findByText(/아직 대화가 없어요/)).toBeInTheDocument();
  });

  it("axe 위반 0", async () => {
    convFx.list = [conv({ id: 1, title: "대화 하나" })];
    const { container, findByText } = renderModal();
    await findByText("대화 하나");
    expect(summarize(await axe(container, AXE_OPTIONS))).toEqual([]);
  });
});
