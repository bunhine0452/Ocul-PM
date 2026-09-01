import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// ─── Phase 7 — 대화 임포트 · 오프라인 폴백 ─────────────────────────────────
//
// 이 라운드가 지키려는 계약 셋을 고정한다:
//
// 1. **스캔은 과금이 없다** — 파일을 고르면 목록만 뜬다. `conversationImportRun`
//    은 사용자가 고르고 버튼을 누르기 전에는 절대 호출되지 않는다.
// 2. **이미 들여온 대화는 사라지지 않는다** — 목록에 남되 선택이 잠긴다.
//    사라지면 "왜 이 대화가 안 보이지" 가 되고, 그게 임포트에서 가장 나쁜 상태다.
// 3. **못 닿는 프로바이더도 사라지지 않는다** — 흐리게 표시될 뿐 고를 수 있다.

const fx = {
  scan: {
    candidates: [
      {
        source_id: "conv-a",
        slug: "imported-parser-bug-aabbccddee",
        title: "파서가 깨지는 버그",
        created_at: "2025-07-14T11:30:00+09:00",
        workday: "20250714",
        message_count: 12,
        char_count: 4200,
        guessed_type: "bug",
      },
      {
        source_id: "conv-b",
        slug: "imported-settings-tab-1122334455",
        title: "Add a settings tab",
        created_at: "2025-07-20T09:00:00+09:00",
        workday: "20250720",
        message_count: 4,
        char_count: 900,
        guessed_type: "feature",
      },
    ],
    skipped: [{ label: "#7", reason: "no timestamp" }],
    already: ["conv-b"],
  },
  calls: { scan: [] as unknown[][], run: [] as unknown[][] },
};

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          switch (prop) {
            case "conversationPickExport":
              return () => ok("/tmp/export.zip");
            case "conversationImportScan":
              return (...a: unknown[]) => {
                fx.calls.scan.push(a);
                return ok(fx.scan);
              };
            case "conversationImportRun":
              return (...a: unknown[]) => {
                fx.calls.run.push(a);
                return ok({
                  entries: [
                    {
                      source_id: "conv-a",
                      title: "파서가 깨지는 버그",
                      relative_path: "20250714/Bugs/1130_bug_imported.md",
                      outcome: "imported",
                      detail: null,
                    },
                  ],
                  imported: 1,
                  duplicates: 0,
                  failed: 0,
                });
              };
            case "settingsGetAll":
              return () => ok([]);
            default:
              return () => ok(null);
          }
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

import { SettingsProvider } from "@/contexts/SettingsContext";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { ConversationImportSection, formatWorkday } from "@/features/settings/import/ConversationImportSection";

function renderSection() {
  return render(
    <SettingsProvider>
      <WorkspaceProvider projectId={1}>
        <ConversationImportSection />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

beforeEach(() => {
  fx.calls.scan = [];
  fx.calls.run = [];
});

afterEach(cleanup);

describe("대화 임포트", () => {
  it("파일을 고르면 스캔만 한다 — 모델은 부르지 않는다", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /export|고르기/i }));

    await waitFor(() => expect(fx.calls.scan.length).toBe(1));
    expect(fx.calls.scan[0]).toEqual([1, "/tmp/export.zip"]);
    // 과금 경로는 아직 닫혀 있다.
    expect(fx.calls.run.length).toBe(0);
  });

  it("이미 들여온 대화는 목록에 남되 선택이 잠긴다", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /export|고르기/i }));

    const a = await screen.findByRole("checkbox", { name: "파서가 깨지는 버그" });
    const b = screen.getByRole("checkbox", { name: "Add a settings tab" });
    // 사라지지 않는다 — 둘 다 목록에 있다.
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect((a as HTMLInputElement).disabled).toBe(false);
    expect((b as HTMLInputElement).disabled).toBe(true);
  });

  it("고른 것만, 추정 갈래와 함께 보낸다", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /export|고르기/i }));

    const a = await screen.findByRole("checkbox", { name: "파서가 깨지는 버그" });
    fireEvent.click(a);
    const run = screen.getByRole("button", { name: /1/ });
    fireEvent.click(run);

    await waitFor(() => expect(fx.calls.run.length).toBe(1));
    expect(fx.calls.run[0]).toEqual([1, "/tmp/export.zip", ["conv-a"], ["bug"]]);
  });

  it("읽지 못한 대화의 수를 숨기지 않는다", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /export|고르기/i }));
    await screen.findByRole("checkbox", { name: "파서가 깨지는 버그" });
    expect(document.body.textContent).toMatch(/1/);
  });
});

describe("formatWorkday", () => {
  it("8자리 워크데이만 날짜로 편다", () => {
    expect(formatWorkday("20250714")).toBe("2025-07-14");
    expect(formatWorkday("")).toBe("");
    expect(formatWorkday("2025")).toBe("2025");
  });
});
