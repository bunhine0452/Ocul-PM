import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// JN-01 (11-15) — the journal detail: the verification box is not squeezed and the evidence stands first.
// `.jd` is a fixed-height flex column; with `overflow: hidden` boxes (verify · diff) their automatic minimum
// height became 0 and a long body pressed them to 7px / 30px. Now: header → verification → body → diff →
// related, every child keeps its height, the diff body has no inner scroll (the wheel is never trapped), and
// the "read" toggle shows its state (✓ + words, pressed surface, a tooltip that says what a click will do).

vi.mock("@/lib/toast", () => ({ toast: { info: vi.fn(), warning: vi.fn(), destructive: vi.fn() } }));
vi.mock("@/api/oculpm", async () => (await import("./journalHarness")).oculpmModule());
vi.mock("@/components/Markdown", () => ({ Markdown: ({ children }: { children: string }) => children }));

import { JournalDetail } from "@/features/oculpm/JournalDetail";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { t } from "@/i18n";
import { entry, jfx, resetJournalFixtures } from "./journalHarness";

const css = readFileSync(join(__dirname, "..", "features", "oculpm", "journal.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
const rule = (selector: string) => {
  const m = new RegExp(`(?:^|\\n)\\s*${selector.replace(/[.*+?^${}()|[\]\\>]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css);
  return m ? m[1] : null;
};

function renderDetail(e = entry({ type: "bug", evidence: 2 })) {
  return render(
    <WorkspaceProvider projectId={1}>
      <JournalDetail projectId={1} entry={e} planLinks={[]} onOpenDiff={vi.fn()} onOpenRelated={vi.fn()} />
    </WorkspaceProvider>,
  );
}

beforeEach(() => {
  resetJournalFixtures();
  jfx.byWorkday["20260531"] = [entry({ type: "bug", evidence: 2 })];
});
afterEach(() => cleanup());

describe("journal detail — evidence first, nothing squeezed", () => {
  it("stands in order: header → verification → body → diff → related", async () => {
    jfx.diffs = [{ path: "src/features/oculpm/journal.css", patch: "@@ -1 +1 @@\n-a\n+b\n" }];
    jfx.related = [{ relative_path: "20260530/F/0900_y.md", title: "Earlier work", score: 1, reasons: [{ code: "shared_files", params: ["2", "src/a.ts"] }] }];
    const { container } = renderDetail();
    await waitFor(() => expect(container.querySelector(".jd-prose")).not.toBeNull());
    await waitFor(() => expect(container.querySelector(".jd-related")).not.toBeNull());
    const order = Array.from(container.querySelector(".jd")!.children).map((c) => c.className.split(" ")[0]);
    expect(order).toEqual(["jd-head", "jd-verify", "jd-prose", "jd-diff", "jd-related"]);
    // 경로는 두 조각 — 폴더가 먼저 줄고 파일 이름은 온전히.
    expect(container.querySelector(".jd-diff-dir")?.textContent).toBe("src/features/oculpm/");
    expect(container.querySelector(".jd-diff-base")?.textContent).toBe("journal.css");
  });

  it("every direct child of .jd keeps its height, and the diff body has no inner vertical scroll", () => {
    expect(rule(".jd > *")).toMatch(/flex-shrink:\s*0/);
    const body = rule(".jd-diff-body");
    expect(body).not.toBeNull();
    expect(body).not.toMatch(/max-height/);
    expect(body).not.toMatch(/overflow:\s*auto/);
  });

  it("the read toggle changes its pressed state, words and tooltip on every press", async () => {
    const { findByRole } = renderDetail(entry({ relative_path: "20260531/F/1000_r.md", type: "bug", evidence: 1 }));
    const btn = await findByRole("button", { pressed: false, name: t("entry.verify") });
    expect(btn.getAttribute("title")).toBe(t("entry.verifyTitle"));
    fireEvent.click(btn);
    await waitFor(() => expect(btn.getAttribute("aria-pressed")).toBe("true"));
    expect(btn.textContent).toBe(t("entry.verified"));
    expect(btn.getAttribute("title")).toBe(t("entry.unverifyTitle"));
    expect(btn.querySelector("svg")).not.toBeNull();
    fireEvent.click(btn);
    await waitFor(() => expect(btn.getAttribute("aria-pressed")).toBe("false"));
    expect(btn.textContent).toBe(t("entry.verify"));
    expect(jfx.verified.map((v) => v.verified)).toEqual([true, false]);
  });

  it("the header meta says it was read, and the day only when it was read here — never the file's mtime", async () => {
    const before = renderDetail(entry({ type: "bug", evidence: 2, verified_by_user: true }));
    await waitFor(() => expect(before.container.querySelector(".jd-prose")).not.toBeNull());
    expect(before.container.querySelector(".jd-meta")?.textContent?.endsWith(` · ${t("entry.verified")}`)).toBe(true);
    before.unmount();
    const { container, findByRole } = renderDetail(entry({ relative_path: "20260531/F/1000_n.md", type: "bug", evidence: 2 }));
    fireEvent.click(await findByRole("button", { pressed: false, name: t("entry.verify") }));
    const now = new Date();
    const date = t("journal.dayMd", { m: String(now.getMonth() + 1), d: String(now.getDate()) });
    await waitFor(() => expect(container.querySelector(".jd-meta")?.textContent).toContain(t("journal.readOn", { date })));
  });
});
