import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { RelatedSuggestion } from "@/lib/bindings";

// ─── 관련 후보 카드 ({#related-suggest} · {#related-ui}) ─────────────────────
//
// 카드의 약속 셋을 문다:
//  1. 후보마다 **근거**가 붙는다 (백엔드는 코드+파라미터만 주고 문장은 화면이).
//  2. 「잇기」는 `oculpm_add_related` 를 `followup` 으로 부르고, 성공하면
//     상세를 다시 읽게 한다 (마스트헤드의 칩이 그때 뜬다).
//  3. 근거 있는 후보가 0 이면 **상자 자체를 안 그린다** — 빈 상자는 정보가
//     아니다.

const api = vi.hoisted(() => ({
  rows: [] as RelatedSuggestion[],
  added: [] as Array<{ rel: string; ref: string; kind: string }>,
  fail: false,
}));
const toastMock = vi.hoisted(() => ({ info: vi.fn(), warning: vi.fn(), destructive: vi.fn() }));
vi.mock("@/lib/toast", () => ({ toast: toastMock }));

vi.mock("@/api/oculpm", () => {
  class MockOculpmApiError extends Error {}
  return {
    OculpmApiError: MockOculpmApiError,
    oculpmApi: {
      suggestRelated: () => Promise.resolve(api.rows),
      addRelated: (_pid: number, rel: string, ref: string, kind: string) => {
        api.added.push({ rel, ref, kind });
        return api.fail
          ? Promise.reject(new MockOculpmApiError("잠겼어요"))
          : Promise.resolve({});
      },
    },
  };
});

import { RelatedSuggestCard } from "@/features/oculpm/RelatedSuggestCard";

function suggestion(over: Partial<RelatedSuggestion> = {}): RelatedSuggestion {
  return {
    relative_path: "20260901/Bugs/0900_bug_watcher.md",
    title: "워처가 멈췄다",
    workday: "20260901",
    entry_type: "bug",
    score: 1.2,
    reasons: [
      { code: "shared_files", params: ["2", "src-tauri/src/oculpm/watcher.rs"] },
      { code: "title", params: ["40"] },
    ],
    ...over,
  };
}

function renderCard(onLinked = () => {}) {
  return render(
    <RelatedSuggestCard
      projectId={1}
      relativePath="20260921/Bugs/1200_bug_again.md"
      relatedCount={0}
      onLinked={onLinked}
    />,
  );
}

beforeEach(() => {
  api.rows = [];
  api.added = [];
  api.fail = false;
  toastMock.info.mockClear();
  toastMock.destructive.mockClear();
});
afterEach(() => cleanup());

describe("관련 후보 카드", () => {
  it("후보마다 근거를 적는다 — 공유 파일과 제목 일치율", async () => {
    api.rows = [suggestion()];
    const { container, findByText } = renderCard();
    await findByText("워처가 멈췄다");
    const why = container.querySelector(".entry-relsug-why");
    expect(why?.textContent).toContain("같은 파일 2개");
    expect(why?.textContent).toContain("oculpm/watcher.rs");
    expect(why?.textContent).toContain("40% 일치");
  });

  it("플래너 항목이 근거면 그 항목 id 를 말한다", async () => {
    api.rows = [
      suggestion({ reasons: [{ code: "plan_item", params: ["related-ui"] }] }),
    ];
    const { container, findByText } = renderCard();
    await findByText("워처가 멈췄다");
    expect(container.querySelector(".entry-relsug-why")?.textContent).toContain("related-ui");
  });

  it("「잇기」는 followup 으로 부르고 상세를 다시 읽게 한다", async () => {
    api.rows = [suggestion()];
    const onLinked = vi.fn();
    const { findByText } = renderCard(onLinked);
    fireEvent.click(await findByText("잇기"));
    await waitFor(() => expect(api.added).toHaveLength(1));
    expect(api.added[0]).toEqual({
      rel: "20260921/Bugs/1200_bug_again.md",
      ref: "20260901/Bugs/0900_bug_watcher.md",
      kind: "followup",
    });
    await waitFor(() => expect(onLinked).toHaveBeenCalled());
    expect(toastMock.info).toHaveBeenCalled();
  });

  it("실패하면 사유를 말한다 — 조용히 성공한 척하지 않는다", async () => {
    api.rows = [suggestion()];
    api.fail = true;
    const onLinked = vi.fn();
    const { findByText } = renderCard(onLinked);
    fireEvent.click(await findByText("잇기"));
    await waitFor(() => expect(toastMock.destructive).toHaveBeenCalled());
    expect(String(toastMock.destructive.mock.calls[0][0])).toContain("잠겼어요");
    expect(onLinked).not.toHaveBeenCalled();
  });

  it("근거 있는 후보가 없으면 아무것도 안 그린다", async () => {
    api.rows = [];
    const { container } = renderCard();
    await waitFor(() => expect(container.querySelector("[aria-busy]")).toBeNull());
    expect(container.querySelector(".entry-relsug")).toBeNull();
  });
});
