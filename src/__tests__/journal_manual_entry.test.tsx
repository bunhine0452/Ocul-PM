import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// The hand-written entry from the journal screen (moved out of journal_v2, 11-15). "New entry" opens the
// form; writing calls createManualEntry with the title and the file name and closes the form; a bad file
// name is an inline error and the write button stays blocked. Since 11-15 the form starts with three fields
// and the file name waits under "More".

vi.mock("@/lib/toast", () => ({ toast: { info: vi.fn(), warning: vi.fn(), destructive: vi.fn() } }));
vi.mock("@/api/oculpm", async () => (await import("./journalHarness")).oculpmModule());
vi.mock("@/api/plan", async () => (await import("./journalHarness")).planModule());
vi.mock("@/lib/bindings", async (importOriginal) =>
  (await import("./journalHarness")).bindingsModule(await importOriginal<typeof import("@/lib/bindings")>()),
);
vi.mock("@/components/Markdown", () => ({ Markdown: ({ children }: { children: string }) => children }));

import { JournalScreenV2, __resetJournalMemory } from "@/features/oculpm/JournalScreenV2";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { t } from "@/i18n";
import { entry, jfx, resetJournalFixtures } from "./journalHarness";

/** 화면을 세우고 「새 일지」 → 폼 → 「자세히」 까지 연다(파일 이름 칸이 그 안에 있다). */
async function openForm() {
  const view = render(
    <WorkspaceProvider projectId={1}>
      <JournalScreenV2 projectId={1} todayKey="20260531" oculpmReady onOpenDiff={vi.fn()} focusPath={null} onFocusConsumed={vi.fn()} />
    </WorkspaceProvider>,
  );
  await waitFor(() => expect(view.container.querySelector(".jd-title")?.textContent).toBe("Existing work"));
  fireEvent.click(screen.getByText(t("journal.new")));
  expect(screen.getByText(t("manual.title"))).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: t("journal.manualMore") }));
  return view;
}

const field = (key: "manual.titleField" | "manual.slugField") => screen.getByLabelText(new RegExp(t(key)));

beforeEach(() => {
  __resetJournalMemory();
  resetJournalFixtures();
  jfx.byWorkday["20260531"] = [entry({ relative_path: "20260531/F/1000_a.md", title: "Existing work" })];
});
afterEach(() => cleanup());

describe("hand-written entry from the journal screen", () => {
  it("'New entry' → form → write calls createManualEntry with the title and file name, and the form closes", async () => {
    await openForm();
    fireEvent.change(field("manual.titleField"), { target: { value: "Written by hand" } });
    fireEvent.change(field("manual.slugField"), { target: { value: "manual-note" } });
    fireEvent.click(screen.getByText(t("manual.submit")));
    await waitFor(() => expect(jfx.created).toHaveLength(1));
    expect(jfx.created[0]).toMatchObject({ title: "Written by hand", slug: "manual-note" });
    await waitFor(() => expect(screen.queryByText(t("manual.title"))).toBeNull());
  });

  it("a bad file name is an inline error and the write button stays blocked", async () => {
    await openForm();
    fireEvent.change(field("manual.titleField"), { target: { value: "Has a title" } });
    fireEvent.change(field("manual.slugField"), { target: { value: "Bad Slug!" } });
    expect(await screen.findByText(t("manual.slugError"))).toBeInTheDocument();
    const submit = screen.getByText(t("manual.submit"));
    expect(submit).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(submit);
    expect(jfx.created).toEqual([]);
  });
});
