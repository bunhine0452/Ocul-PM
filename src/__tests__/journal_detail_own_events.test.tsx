// 일지 상세는 **그 일지**의 사건에만 다시 읽는다 (11-22).
//
// 열어 둔 상세는 프로젝트의 어느 일지가 더해지거나 고쳐지든 본문(`getJournalEntry`)과 기록된 diff 전부
// (`getEntryDiffs`)를 다시 읽었다. 에이전트 여럿이 일지를 쓰는 날에는 읽고 있는 일지와 상관없는 사건마다 IPC
// 둘이 갔다. 사건은 어느 일지인지를 싣고 온다 — 그 일지가 아니면 듣지 않는다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";

vi.mock("@/lib/toast", () => ({ toast: { info: vi.fn(), warning: vi.fn(), destructive: vi.fn() } }));
vi.mock("@/api/oculpm", async () => (await import("./journalHarness")).oculpmModule());
vi.mock("@/lib/bindings", async (importOriginal) =>
  (await import("./journalHarness")).bindingsModule(await importOriginal<typeof import("@/lib/bindings")>()),
);
vi.mock("@/components/Markdown", () => ({ Markdown: ({ children }: { children: string }) => children }));

import { oculpmApi } from "@/api/oculpm";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { JournalDetail } from "@/features/oculpm/JournalDetail";
import { journalEventPath } from "@/features/oculpm/useOculpmLive";
import { emit, entry, jfx, resetJournalFixtures } from "./journalHarness";

const OPEN = "20260531/Bugs/1000_bug_open.md";
const open = entry({ relative_path: OPEN, type: "bug", evidence: 2, title: "Open entry" });

/** 250ms 병합 창을 넘긴다. */
const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 320))));

function mount() {
  const entryRead = vi.spyOn(oculpmApi, "getJournalEntry");
  const diffRead = vi.spyOn(oculpmApi, "getEntryDiffs");
  const utils = render(
    <WorkspaceProvider projectId={1}>
      <JournalDetail projectId={1} entry={open} planLinks={[]} onOpenDiff={vi.fn()} onOpenRelated={vi.fn()} />
    </WorkspaceProvider>,
  );
  return { ...utils, entryRead, diffRead };
}

beforeEach(() => {
  resetJournalFixtures();
  jfx.byWorkday["20260531"] = [open];
  jfx.diffs = [{ path: "src/a.ts", patch: "@@ -1 +1 @@\n-a\n+b\n" }];
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("journal detail — rereads only for its own entry", () => {
  it("ten other entries added or updated cause no reread", async () => {
    const { container, entryRead, diffRead } = mount();
    await waitFor(() => expect(container.querySelector(".jd-prose")).not.toBeNull());
    await waitFor(() => expect(diffRead).toHaveBeenCalledTimes(1));
    expect(entryRead).toHaveBeenCalledTimes(1);

    // 다른 에이전트 열이 저마다 일지를 쓴다 — 병합 창(250ms)을 넘겨 가며 하나씩.
    for (let i = 0; i < 10; i++) {
      const other = entry({ relative_path: `20260531/Features_to_add/11${String(i).padStart(2, "0")}_feature_o${i}.md` });
      act(() => emit(i % 2 ? "oculpmJournalAdded" : "oculpmJournalUpdated", { project_id: 1, summary: other }));
      await settle();
    }
    expect(entryRead).toHaveBeenCalledTimes(1); // 예전엔 11
    expect(diffRead).toHaveBeenCalledTimes(1); // 예전엔 11
  });

  it("rereads when this entry is updated", async () => {
    const { container, entryRead, diffRead } = mount();
    await waitFor(() => expect(diffRead).toHaveBeenCalledTimes(1));
    jfx.bodies[OPEN] = "[x] Open entry\n\n## Flow\nrewritten by the agent\n\n## Verification\n- `pnpm test` → 4 passed\n";
    act(() => emit("oculpmJournalUpdated", { project_id: 1, summary: open }));
    await waitFor(() => expect(container.querySelector(".jd-prose")?.textContent).toContain("rewritten by the agent"));
    expect(entryRead).toHaveBeenCalledTimes(2);
    expect(diffRead).toHaveBeenCalledTimes(2);
  });

  it("rereads when the late diff capture announces this entry with the .oculpm/journal/ prefix", async () => {
    const { container, diffRead } = mount();
    await waitFor(() => expect(diffRead).toHaveBeenCalledTimes(1));
    jfx.diffs = [{ path: "src/late.ts", patch: "@@ -1 +1 @@\n-x\n+y\n" }];
    act(() => emit("oculpmJournalPathChanged", { project_id: 1, relative_path: `.oculpm/journal/${OPEN}`, op: "update" }));
    await waitFor(() => expect(container.querySelector(".jd-diff-base")?.textContent).toBe("late.ts"));
    expect(diffRead).toHaveBeenCalledTimes(2);
  });

  it("ignores another project's event for the same path, and rereads when the path cannot be read", async () => {
    const { diffRead } = mount();
    await waitFor(() => expect(diffRead).toHaveBeenCalledTimes(1));
    act(() => emit("oculpmJournalUpdated", { project_id: 2, summary: open }));
    await settle();
    expect(diffRead).toHaveBeenCalledTimes(1);
    // 경로를 못 읽은 사건 — 모르는 것을 「상관없다」 고 하지 않는다.
    act(() => emit("oculpmJournalPathChanged", { project_id: 1, op: "update" }));
    await waitFor(() => expect(diffRead).toHaveBeenCalledTimes(2));
  });
});

describe("journalEventPath", () => {
  it("reads the journal-root path from every payload shape", () => {
    expect(journalEventPath({ project_id: 1, summary: { relative_path: OPEN } })).toBe(OPEN);
    expect(journalEventPath({ project_id: 1, relative_path: `.oculpm/journal/${OPEN}` })).toBe(OPEN);
    expect(journalEventPath({ project_id: 1, relative_path: `journal/${OPEN}` })).toBe(OPEN);
    expect(journalEventPath({ project_id: 1, relative_path: `.oculpm\\journal\\${OPEN.replace(/\//g, "\\")}` })).toBe(OPEN);
    expect(journalEventPath({ project_id: 1 })).toBeNull();
    expect(journalEventPath({ project_id: 1, relative_path: "" })).toBeNull();
  });
});
