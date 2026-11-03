// 화면 오류 문장 (2026-11-04 화면 검사) — 목록을 못 불러왔을 때 오류 카드에 `Error: …` 접두나
// `[object Object]` 가 실리던 것. 오류는 `tError(toAppError(e))` 하나로 접어 원문만 남긴다.
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";

const { brief } = vi.hoisted(() => ({
  brief: vi.fn(async (): Promise<unknown> => ({ status: "error", error: { code: "unknown", detail: "database is locked" } })),
}));
vi.mock("@/lib/bindings", async (orig) => {
  const real = await orig<typeof import("@/lib/bindings")>();
  return { ...real, commands: { ...real.commands, oculpmWorkdayBrief: brief } };
});
vi.mock("@/features/oculpm/useOculpmLive", () => ({ useJournalEvents: () => {} }));

import { useJournalDays } from "@/features/oculpm/useJournalDays";
import { tError } from "@/i18n/errors";
import { toAppError } from "@/api/invoke";

afterEach(() => {
  cleanup();
  brief.mockClear();
});

describe("error text", () => {
  it("a thrown Error folds to its message, without the `Error:` prefix", () => {
    expect(tError(toAppError(new Error("database is locked")))).toBe("database is locked");
    expect(tError(toAppError({ code: "unknown", detail: "x" }))).toBe("x");
  });

  it("the journal list shows the backend detail as-is when the brief fails", async () => {
    const { result } = renderHook(() => useJournalDays(1, "20261104", true));
    await waitFor(() => expect(result.current.error).toBe("database is locked"));
    expect(result.current.days).toBeNull();
  });

  it("a rejected transport call also lands as plain text", async () => {
    brief.mockRejectedValueOnce(new Error("ipc closed"));
    const { result } = renderHook(() => useJournalDays(1, "20261104", true));
    await waitFor(() => expect(result.current.error).toBe("ipc closed"));
  });
});
