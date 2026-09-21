import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { JournalEntrySummary } from "@/lib/bindings";

// ─── 확인은 내용에 묶인다 ({#reviewed-hash}, 2026-09-15) ─────────────────────
//
// `verified_by_user` 가 참이어도 확인 뒤 본문이 바뀌면(`verified_stale`) 그
// 일지는 확인된 것이 아니다. 원장 행은 체크 대신 「다시 검토」를, 열람 화면의
// 마스트헤드는 한 줄을, 툴바 토글은 「다시 검토」(누르면 같은 커맨드에 `true`)
// 를 그린다. `journal_v2.test.tsx` 의 이웃이지만 그 파일은 크기 래칫에 걸려
// 있어(`scripts/check-file-sizes.mjs`) 형제 파일로 둔다 — 화면 전체가 아니라
// `JournalRow` · `EntryDetailView` 를 직접 그린다.

function summary(over: Partial<JournalEntrySummary> = {}): JournalEntrySummary {
  return {
    relative_path: "20260531/Features_to_add/1000_feature_x.md",
    workday: "20260531",
    type: "feature",
    slug: "x",
    status: "done",
    difficulty: null,
    title: "샘플 작업",
    checkbox: null,
    session_id: "20260531-001",
    agent_id: "claude-code",
    agent_version: null,
    verified_by_user: false,
    verified_stale: false,
    created_at: "2026-05-31T10:00:00+09:00",
    updated_at: null,
    tags: [],
    files_count: 0,
    parse_ok: true,
    parse_warnings: [],
    ...over,
  };
}

// `vi.mock` 팩토리가 직접 참조하므로 hoisted — journal_v2 와 같은 관용구.
const verifyMock = vi.hoisted(() => ({
  calls: [] as Array<{ projectId: number; relativePath: string; verified: boolean }>,
}));
const toastMock = vi.hoisted(() => ({ info: vi.fn(), warning: vi.fn(), destructive: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast: toastMock }));

vi.mock("@/api/oculpm", () => {
  class MockOculpmApiError extends Error {}
  return {
    OculpmApiError: MockOculpmApiError,
    oculpmApi: {
      getJournalEntry: (_pid: number, relativePath: string) =>
        Promise.resolve({
          relative_path: relativePath,
          body_markdown: "## 동작 흐름\n- 무언가를 변경했다\n",
          frontmatter: { files_touched: [], related: [] },
          parse_ok: true,
          parse_warnings: [],
          verified_stale: false,
        }),
      getEntryDiffs: () => Promise.resolve([]),
      // {#related-ui} — 상세가 열릴 때 후보를 묻는다. 이 스위트의 관심은 아니라 빈 목록.
      suggestRelated: () => Promise.resolve([]),
      // 백엔드는 `true` 에 지금 본문의 해시를 묶고, `false` 에 그 줄을 지운다.
      setJournalVerified: (pid: number, relativePath: string, verified: boolean) => {
        verifyMock.calls.push({ projectId: pid, relativePath, verified });
        return Promise.resolve(null);
      },
    },
  };
});

// 서술 칸의 <Markdown> 은 SettingsProvider 를 요구한다 — 여기선 글자만 본다.
vi.mock("@/components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => children,
}));

import { JournalRow } from "@/features/oculpm/JournalRow";
import { EntryDetailView } from "@/features/oculpm/EntryDetailView";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { isConfirmed, isStaleVerified } from "@/features/oculpm/verified";

function renderRow(entry: JournalEntrySummary) {
  return render(
    <JournalRow entry={entry} focused={false} showAgent={false} showSource={false} onOpenEntry={() => {}} />,
  );
}

function renderDetail(entry: JournalEntrySummary) {
  return render(
    <WorkspaceProvider projectId={1}>
      <EntryDetailView projectId={1} entry={entry} onBack={() => {}} onOpenDiff={() => {}} />
    </WorkspaceProvider>,
  );
}

beforeEach(() => {
  verifyMock.calls = [];
});
afterEach(() => cleanup());

describe("isConfirmed / isStaleVerified — 「확인됨」의 뜻 하나", () => {
  it("플래그만으로는 확인이 아니다 — 확인 뒤 바뀐 일지는 confirmed 가 아니고 stale 이다", () => {
    const ok = summary({ verified_by_user: true });
    const stale = summary({ verified_by_user: true, verified_stale: true });
    const no = summary();
    expect([isConfirmed(ok), isStaleVerified(ok)]).toEqual([true, false]);
    expect([isConfirmed(stale), isStaleVerified(stale)]).toEqual([false, true]);
    expect([isConfirmed(no), isStaleVerified(no)]).toEqual([false, false]);
  });
});

describe("원장 행 — 체크 대신 「다시 검토」", () => {
  it("그대로 확인된 일지는 체크", () => {
    const { container } = renderRow(summary({ verified_by_user: true }));
    expect(container.querySelector(".jl-verified")).not.toBeNull();
    expect(container.querySelector(".jl-stale")).toBeNull();
  });

  it("확인 뒤 바뀐 일지는 체크가 없고 경고 잉크의 「다시 검토」", () => {
    const { container } = renderRow(summary({ verified_by_user: true, verified_stale: true }));
    expect(container.querySelector(".jl-verified")).toBeNull();
    const stale = container.querySelector(".jl-stale");
    expect(stale?.textContent).toContain("다시 검토");
    expect(stale?.getAttribute("title")).toBe("확인 뒤 내용이 변경됐어요 · 다시 검토");
  });

  it("확인 안 된 일지는 둘 다 없다", () => {
    const { container } = renderRow(summary());
    expect(container.querySelector(".jl-verified")).toBeNull();
    expect(container.querySelector(".jl-stale")).toBeNull();
  });
});

describe("열람 — 마스트헤드의 한 줄과 툴바의 「다시 검토」", () => {
  it("확인 뒤 바뀐 일지: 마스트헤드가 말하고, 버튼은 눌리지 않은 「다시 검토」, 누르면 true 로 다시 묶는다", async () => {
    const entry = summary({
      relative_path: "20260531/Features/1000_stale.md",
      title: "확인 뒤 바뀜",
      verified_by_user: true,
      verified_stale: true,
    });
    const { container, getByRole } = renderDetail(entry);
    await waitFor(() =>
      expect(container.querySelector(".entry-stale")?.textContent).toContain(
        "확인 뒤 내용이 변경됐어요 · 다시 검토",
      ),
    );
    const btn = getByRole("button", { name: /다시 검토/, pressed: false });
    fireEvent.click(btn);
    await waitFor(() =>
      expect(verifyMock.calls).toEqual([
        { projectId: 1, relativePath: "20260531/Features/1000_stale.md", verified: true },
      ]),
    );
    // 다시 묶였다 — 워처 왕복 없이 바로 「확인됨」이고 마스트헤드의 줄은 진다.
    await waitFor(() => expect(getByRole("button", { name: "확인됨", pressed: true })).toBeTruthy());
    expect(container.querySelector(".entry-stale")).toBeNull();
  });

  it("그대로 확인된 일지: 줄이 없고, 「확인됨」을 누르면 해제(false)", async () => {
    const entry = summary({
      relative_path: "20260531/Features/1000_ok.md",
      title: "그대로 확인됨",
      verified_by_user: true,
    });
    const { container, getByRole } = renderDetail(entry);
    await waitFor(() => expect(container.querySelector(".entry-mast")).not.toBeNull());
    expect(container.querySelector(".entry-stale")).toBeNull();
    fireEvent.click(getByRole("button", { name: "확인됨", pressed: true }));
    await waitFor(() =>
      expect(verifyMock.calls).toEqual([
        { projectId: 1, relativePath: "20260531/Features/1000_ok.md", verified: false },
      ]),
    );
    await waitFor(() => expect(getByRole("button", { name: "확인", pressed: false })).toBeTruthy());
  });

  it("확인 안 된 일지: 「확인」을 누르면 true — 이때 백엔드가 해시를 묶는다", async () => {
    const entry = summary({ relative_path: "20260531/Features/1000_no.md", title: "확인 안 됨" });
    const { container, getByRole } = renderDetail(entry);
    await waitFor(() => expect(container.querySelector(".entry-mast")).not.toBeNull());
    fireEvent.click(getByRole("button", { name: "확인", pressed: false }));
    await waitFor(() =>
      expect(verifyMock.calls).toEqual([
        { projectId: 1, relativePath: "20260531/Features/1000_no.md", verified: true },
      ]),
    );
    await waitFor(() => expect(getByRole("button", { name: "확인됨", pressed: true })).toBeTruthy());
  });
});
