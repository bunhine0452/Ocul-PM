// 모바일 AI 탭 (#mb4-chat-sse) — SSE 스트리밍 누적·영속 계약.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const settingsGet = vi.fn();
const conversationList = vi.fn();
const conversationCreate = vi.fn();
const chatMessageAppend = vi.fn();
const chatMessageList = vi.fn();

vi.mock("@/lib/bindings", () => ({
  commands: {
    settingsGet: (...a: unknown[]) => settingsGet(...a),
    conversationList: (...a: unknown[]) => conversationList(...a),
    conversationCreate: (...a: unknown[]) => conversationCreate(...a),
    chatMessageAppend: (...a: unknown[]) => chatMessageAppend(...a),
    chatMessageList: (...a: unknown[]) => chatMessageList(...a),
  },
}));

import { AiTab } from "@/mobile/tabs/AiTab";
import { t } from "@/i18n";

function sseBody(frames: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f));
      controller.close();
    },
  });
}

beforeEach(() => {
  settingsGet.mockImplementation(async (key: string) => ({
    status: "ok",
    data: key === "default_provider" ? "anthropic" : null,
  }));
  conversationList.mockResolvedValue({ status: "ok", data: [] });
  conversationCreate.mockResolvedValue({ status: "ok", data: { id: 42, title: "Mobile" } });
  chatMessageAppend.mockResolvedValue({ status: "ok", data: null });
  chatMessageList.mockResolvedValue({ status: "ok", data: [] });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test("streams deltas into one assistant bubble and persists both sides", async () => {
  const fetchMock = vi.fn(async (url: string) => {
    expect(url).toBe("/api/chat");
    return {
      ok: true,
      body: sseBody([
        'event: chat\ndata: {"kind":"delta","text":"he"}\n\n',
        'event: chat\ndata: {"kind":"delta","text":"llo"}\n\nevent: chat\ndata: {"kind":"done"}\n\n',
      ]),
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);

  render(<AiTab projectId={7} />);
  const input = await screen.findByPlaceholderText(t("mobile.ai.placeholder"));
  fireEvent.change(input, { target: { value: "hello" } });
  fireEvent.keyDown(input, { key: "Enter" });

  await waitFor(() => expect(screen.getByText("hello")).toBeTruthy());

  // 사용자 메시지 → user append, 스트림 종료 → assistant append.
  await waitFor(() => expect(chatMessageAppend).toHaveBeenCalledTimes(2));
  expect(chatMessageAppend).toHaveBeenNthCalledWith(1, 42, "user", "hello", "anthropic", expect.any(String));
  expect(chatMessageAppend).toHaveBeenNthCalledWith(2, 42, "assistant", "hello", "anthropic", expect.any(String));
});

test("stream error surfaces the message and removes the empty bubble", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      body: sseBody(['event: chat\ndata: {"kind":"error","message":"API key for anthropic is not set"}\n\n']),
    }) as unknown as Response),
  );

  render(<AiTab projectId={7} />);
  const input = await screen.findByPlaceholderText(t("mobile.ai.placeholder"));
  fireEvent.change(input, { target: { value: "hi" } });
  fireEvent.keyDown(input, { key: "Enter" });

  await waitFor(() => expect(screen.getByText(/API key for anthropic/)).toBeTruthy());
});
