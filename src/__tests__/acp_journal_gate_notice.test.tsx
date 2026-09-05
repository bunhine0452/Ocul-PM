import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { AcpObjection } from "@/lib/bindings";

// {#gate-beyond-cc} — 배달 게이트를 Claude Code 밖으로.
//
// Claude Code 는 `Stop` 훅에서 `exit 2` 로 턴을 되돌릴 수 있지만 앱 안 ACP
// 대화에는 그 수단이 없다. 대신 배너 하나다. 여기서 무는 것은 **그 배너가
// 소음이 아닌가**이다: 이의가 없으면 아무 것도 안 그리고, 턴이 끝날 때마다
// 다시 물어 기록하면 스스로 사라지고, 닫으면 백엔드에도 알린다.

const journalObjection = vi.fn();
const dismissJournalObjection = vi.fn();
vi.mock("@/api/acp", () => ({
  acpApi: {
    journalObjection: (...args: unknown[]) => journalObjection(...args),
    dismissJournalObjection: (...args: unknown[]) => dismissJournalObjection(...args),
  },
}));

const { JournalGateNotice } = await import("@/features/chat/RecordingNotice");

const OBJECTION: AcpObjection = {
  acp_session_id: "uuid-1",
  conversation: "acp-20260905-abcd1234",
  changed: ["src/lib.rs", "src-tauri/src/acp/mod.rs"],
  reason: "이 대화에서 바꾼 파일 2개가 아직 기록되지 않았습니다.",
  action: "논리 단위가 끝났으면 journal_write 로 위 파일 2개를 기록하고 plan_update 로 갱신하세요.",
};

beforeEach(() => {
  journalObjection.mockReset();
  dismissJournalObjection.mockReset();
  dismissJournalObjection.mockResolvedValue(true);
});
afterEach(cleanup);

describe("앱 안 배달 게이트 배너", () => {
  it("이의가 없으면 아무 것도 그리지 않는다", async () => {
    journalObjection.mockResolvedValue(null);
    render(<JournalGateNotice sessionId="uuid-1" turnKey={0} />);
    await waitFor(() => expect(journalObjection).toHaveBeenCalledWith("uuid-1"));
    expect(document.querySelector(".failure")).toBeNull();
  });

  it("이의면 바뀐 파일과 **무엇을 하라**를 함께 보여 준다", async () => {
    journalObjection.mockResolvedValue(OBJECTION);
    render(<JournalGateNotice sessionId="uuid-1" turnKey={0} />);

    const banner = await screen.findByRole("status");
    expect(banner.textContent).toContain("아직 기록되지 않았어요");
    // 사유와 대상 — 「일지를 쓰세요」로는 무엇을 어디에 적을지 모른다.
    expect(banner.textContent).toContain("src/lib.rs");
    expect(banner.textContent).toContain("src-tauri/src/acp/mod.rs");
    expect(banner.textContent).toContain("journal_write");
  });

  it("세션이 열리기 전에는 묻지도, 말하지도 않는다", async () => {
    journalObjection.mockResolvedValue(OBJECTION);
    render(<JournalGateNotice sessionId={null} turnKey={0} />);
    await Promise.resolve();
    expect(journalObjection).not.toHaveBeenCalled();
    expect(document.querySelector(".failure")).toBeNull();
  });

  it("조회가 실패해도 대화 위에 또 다른 오류를 얹지 않는다", async () => {
    journalObjection.mockRejectedValue(new Error("nope"));
    render(<JournalGateNotice sessionId="uuid-1" turnKey={0} />);
    await waitFor(() => expect(journalObjection).toHaveBeenCalled());
    expect(document.querySelector(".failure")).toBeNull();
  });

  /** 판정은 **턴이 끝난 순간**에 내려진다 — 그 전에 물으면 한 턴 뒤진 답을 본다. */
  it("턴이 끝날 때마다 다시 묻는다", async () => {
    journalObjection.mockResolvedValue(null);
    const view = render(<JournalGateNotice sessionId="uuid-1" turnKey={true} />);
    await waitFor(() => expect(journalObjection).toHaveBeenCalledTimes(1));

    view.rerender(<JournalGateNotice sessionId="uuid-1" turnKey={false} />);
    await waitFor(() => expect(journalObjection).toHaveBeenCalledTimes(2));
  });

  /** 기록하면 스스로 사라진다 — 백엔드가 매 턴 다시 판정해 `null` 을 돌려준다. */
  it("기록하면 배너가 걷힌다", async () => {
    journalObjection.mockResolvedValue(OBJECTION);
    const view = render(<JournalGateNotice sessionId="uuid-1" turnKey={true} />);
    await screen.findByRole("status");

    journalObjection.mockResolvedValue(null);
    view.rerender(<JournalGateNotice sessionId="uuid-1" turnKey={false} />);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("닫으면 사라지고, 그 사실을 백엔드에도 알린다", async () => {
    journalObjection.mockResolvedValue(OBJECTION);
    render(<JournalGateNotice sessionId="uuid-1" turnKey={0} />);
    await screen.findByRole("status");

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    });
    expect(screen.queryByRole("status")).toBeNull();
    // 화면에서만 닫으면 다음 턴에 그대로 다시 뜬다.
    expect(dismissJournalObjection).toHaveBeenCalledWith("uuid-1");
  });

  /** 대화를 옮기는 사이 도착한 옆 대화의 답이 이 대화 위에 뜨면 안 된다. */
  it("다른 대화의 이의는 이 대화 위에 그리지 않는다", async () => {
    journalObjection.mockResolvedValue(OBJECTION);
    render(<JournalGateNotice sessionId="uuid-2" turnKey={0} />);
    await waitFor(() => expect(journalObjection).toHaveBeenCalledWith("uuid-2"));
    expect(document.querySelector(".failure")).toBeNull();
  });
});
