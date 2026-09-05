import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { AcpRecordingStatus } from "@/lib/bindings";

// {#mcp-missing-visible} — 기록 도구 없이 열리던 세션을 보이게.
//
// 예전에는 `client_mcp_servers()` 가 바이너리를 못 찾으면 빈 목록을 돌려주고
// 세션이 그대로 열렸다. 에이전트에게는 `journal_write` 가 아예 없는데 화면에는
// 아무 표시도 없었다. 여기서 무는 것은 **침묵이 사라졌는가**이지 경고가
// 늘었는가가 아니다 — 붙었을 때는 여전히 아무 것도 안 그려야 한다.

const recordingStatus = vi.fn();
vi.mock("@/api/acp", () => ({
  acpApi: { recordingStatus: (...args: unknown[]) => recordingStatus(...args) },
}));

const { RecordingNotice } = await import("@/features/chat/RecordingNotice");

const MISSING: AcpRecordingStatus = {
  attached: false,
  binary_path: null,
  searched: [
    "/Applications/ocul-pm.app/Contents/MacOS/oculpm-mcp",
    "/Users/kim/.local/bin/oculpm-mcp",
  ],
  session_token: "acp-20260905-abcd1234",
  acp_session_id: "uuid-1",
};

const ATTACHED: AcpRecordingStatus = {
  attached: true,
  binary_path: "/Applications/ocul-pm.app/Contents/MacOS/oculpm-mcp",
  searched: [],
  session_token: "acp-20260905-abcd1234",
  acp_session_id: "uuid-1",
};

beforeEach(() => {
  recordingStatus.mockReset();
});
afterEach(cleanup);

describe("기록 도구 부재 배너", () => {
  it("도구가 붙었으면 아무 것도 그리지 않는다", async () => {
    recordingStatus.mockResolvedValue(ATTACHED);
    render(<RecordingNotice projectId={1} provider="claude" sessionId="uuid-1" />);
    await waitFor(() => expect(recordingStatus).toHaveBeenCalled());
    expect(document.querySelector(".failure")).toBeNull();
  });

  it("못 찾았으면 어디를 봤는지와 고치는 법을 함께 보여 준다", async () => {
    recordingStatus.mockResolvedValue(MISSING);
    render(<RecordingNotice projectId={1} provider="codex" sessionId="uuid-1" />);

    const banner = await screen.findByRole("status");
    expect(banner.textContent).toContain("기록 도구 없이 열린 대화예요");
    // 사유 — 찾아본 자리가 실제로 읽혀야 한다.
    expect(banner.textContent).toContain("/Applications/ocul-pm.app/Contents/MacOS/oculpm-mcp");
    expect(banner.textContent).toContain("/Users/kim/.local/bin/oculpm-mcp");
    // 조치 — 앱 설치 / OCULPM_MCP_BIN.
    expect(banner.textContent).toContain("OCULPM_MCP_BIN");
  });

  it("세션이 열리기 전에는 묻지도, 말하지도 않는다", async () => {
    recordingStatus.mockResolvedValue(MISSING);
    render(<RecordingNotice projectId={1} provider="claude" sessionId={null} />);
    await Promise.resolve();
    expect(recordingStatus).not.toHaveBeenCalled();
    expect(document.querySelector(".failure")).toBeNull();
  });

  it("아직 모르면(연 적 없음) 아무 말도 안 한다 — 모르는 것을 없다고 하지 않는다", async () => {
    recordingStatus.mockResolvedValue(null);
    render(<RecordingNotice projectId={1} provider="claude" sessionId="uuid-1" />);
    await waitFor(() => expect(recordingStatus).toHaveBeenCalled());
    expect(document.querySelector(".failure")).toBeNull();
  });

  it("조회가 실패해도 대화 위에 또 다른 오류를 얹지 않는다", async () => {
    recordingStatus.mockRejectedValue(new Error("nope"));
    render(<RecordingNotice projectId={1} provider="claude" sessionId="uuid-1" />);
    await waitFor(() => expect(recordingStatus).toHaveBeenCalled());
    expect(document.querySelector(".failure")).toBeNull();
  });

  it("닫으면 사라진다 — 경고는 한 번이면 된다", async () => {
    recordingStatus.mockResolvedValue(MISSING);
    render(<RecordingNotice projectId={1} provider="claude" sessionId="uuid-1" />);
    await screen.findByRole("status");

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("대화를 바꾸면 그 대화의 상태를 다시 묻는다", async () => {
    recordingStatus.mockResolvedValue(ATTACHED);
    const view = render(
      <RecordingNotice projectId={1} provider="claude" sessionId="uuid-1" />,
    );
    await waitFor(() => expect(recordingStatus).toHaveBeenCalledTimes(1));

    view.rerender(<RecordingNotice projectId={1} provider="claude" sessionId="uuid-2" />);
    await waitFor(() => expect(recordingStatus).toHaveBeenCalledTimes(2));
  });
});
