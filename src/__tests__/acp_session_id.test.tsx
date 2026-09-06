import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SessionIdChip, resumeCommand, shortSessionId } from "@/features/chat/SessionIdChip";
import { SessionPanel } from "@/features/chat/conversation/SessionPanel";
import type { AcpSessionSummary } from "@/lib/bindings";

// 세션 id 를 화면에 두는 계약.
//
// 이 화면의 대화는 Claude Code 자신의 세션 스토어에 있으므로, id 만 있으면
// 터미널에서 `claude --resume <id>` 로 그대로 이어 열 수 있다. 그 id 가 화면
// 어디에도 없으면 앱과 터미널은 서로 남남이 된다.

const FULL = "3f9a1c07-5b21-4d8e-9c33-77aa0be41d52";

afterEach(cleanup);

function session(id: string, title: string): AcpSessionSummary {
  return { id, title, updated_at: new Date().toISOString() };
}

describe("세션 id 칩", () => {
  it("앞 8 자만 적는다 — 좁은 자리에서 제목을 밀어내지 않게", () => {
    expect(shortSessionId(FULL)).toBe("3f9a1c07");
    render(<SessionIdChip sessionId={FULL} />);
    expect(screen.getByText("3f9a1c07")).toBeInTheDocument();
  });

  it("복사되는 것은 **전체 id** 다 — 8 자로는 resume 이 안 된다", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    render(<SessionIdChip sessionId={FULL} />);
    fireEvent.click(screen.getByLabelText("세션 id 복사 (claude --resume)"));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(FULL));
  });

  it("툴팁이 칠 명령을 그대로 보여 준다", () => {
    expect(resumeCommand(FULL)).toBe(`claude --resume ${FULL}`);
    render(<SessionIdChip sessionId={FULL} />);
    expect(screen.getByLabelText("세션 id 복사 (claude --resume)")).toHaveAttribute(
      "title",
      `claude --resume ${FULL}`,
    );
  });
});

describe("지난 대화 목록", () => {
  function renderPanel() {
    return render(
      <SessionPanel
        open
        sessions={[session(FULL, "어제 하던 것"), session("aabbccdd-0000", "그제 하던 것")]}
        currentId={FULL}
        query=""
        onQuery={() => {}}
        onPick={() => {}}
        onNew={() => {}}
        onRename={() => {}}
        onDelete={() => {}}
        names={{}}
        stateOf={() => null}
        sourceOf={() => "none"}
        onStop={() => {}}
      />,
    );
  }

  it("**줄마다** id 가 보인다 — 열지 않고도 어느 대화인지 가른다", () => {
    const { container } = renderPanel();
    const ids = Array.from(container.querySelectorAll(".acp-session-id")).map(
      (el) => el.textContent,
    );
    expect(ids).toEqual(["3f9a1c07", "aabbccdd"]);
  });

  it("줄마다 복사 버튼이 하나씩 — 열지 않고 id 만 가져간다", () => {
    renderPanel();
    expect(screen.getAllByLabelText("세션 id 복사 (claude --resume)")).toHaveLength(2);
  });

  it("상대 시각은 그대로 남는다 (id 가 그 자리를 뺏지 않는다)", () => {
    const { container } = renderPanel();
    expect(container.querySelectorAll(".acp-session-time")).toHaveLength(2);
  });
});
