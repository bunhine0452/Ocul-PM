// 영수증을 일지 · 오늘에서도 한 키로, 그리고 앱 없는 동료에게 HTML 한 장으로 (11-23 love-round L8
// #share-receipt-everywhere · #reviewer-mode-share-link).
//
// 공유할 수 있는 것이 변경 화면의 PR 영수증 하나뿐이었다. 이제 일지 상세 · 오늘 툴바에 같은 단추가 서고 ⇧⌘C 가 떠 있는
// 화면의 영수증을 복사한다. 형식은 `receipt.ts` 하나 — 일지 한 건도 같은 줄 모양이고, HTML 저장은 그 마크다운을 그대로 옮긴
// 자체완결 문서(스크립트 · 바깥 자원 없음)다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";

const saved = vi.hoisted(() => ({ calls: [] as Array<{ name: string; html: string }> }));
vi.mock("@/lib/toast", () => ({ toast: { info: vi.fn(), warning: vi.fn(), destructive: vi.fn() } }));
vi.mock("@/api/oculpm", async () => (await import("./journalHarness")).oculpmModule());
vi.mock("@/api/plan", () => ({
  planApi: {
    journalLinks: () => Promise.resolve([]),
    todayDigest: () =>
      Promise.resolve({
        plans: [
          {
            plan_id: "p",
            title: "Plan P",
            progress: 1,
            done_count: 1,
            item_count: 1,
            closable: false,
            updated_at: "2026-05-31",
            done_when: null,
            check: "pnpm test",
            last_verdict: { passed: false, summary: "2 failed", ts: "2026-05-31T11:00:00+09:00", agent_id: "claude-code", item_id: "a" },
            stale_files: [],
            next: null,
          },
        ],
        needs_user: [],
        blocked: [],
        journal_plan: [],
      }),
  },
}));
vi.mock("@/api/race", () => ({
  raceApi: {
    receipt: () => Promise.resolve({ branch: "feat/x", base_label: "main", commits: 1, files: 1, journals: [], unrecorded: [] }),
    saveReceiptHtml: (name: string, html: string) => {
      saved.calls.push({ name, html });
      return Promise.resolve("/tmp/receipt.html");
    },
  },
}));
vi.mock("@/lib/bindings", async (importOriginal) =>
  (await import("./journalHarness")).bindingsModule(await importOriginal<typeof import("@/lib/bindings")>()),
);
vi.mock("@/components/Markdown", () => ({ Markdown: ({ children }: { children: string }) => children }));

import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { BranchReceiptButton, isReceiptChord } from "@/features/diff/ReceiptButton";
import { journalReceiptMarkdown, proofLine } from "@/features/diff/receipt";
import { escapeHtml, receiptBodyHtml, receiptFileName, receiptHtmlDocument } from "@/features/diff/receiptHtml";
import { JournalDetail } from "@/features/oculpm/JournalDetail";
import { setLangSetting, t } from "@/i18n";
import { toast } from "@/lib/toast";
import { entry, jfx, resetJournalFixtures } from "./journalHarness";

const clip = { writeText: vi.fn((_s: string) => Promise.resolve()) };

beforeEach(() => {
  setLangSetting("en");
  resetJournalFixtures();
  saved.calls.length = 0;
  clip.writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: clip, configurable: true });
});
afterEach(cleanup);

const E = entry({ relative_path: "20260531/Bugs/1000_bug_x.md", type: "bug", title: "Shell: names clashed", evidence: 2 });
const LINK = { journal_ref: ".oculpm/journal/20260531/Bugs/1000_bug_x.md", plan_id: "p", plan_title: "Plan P", item_id: "a" };

function renderDetail() {
  jfx.byWorkday["20260531"] = [E];
  return render(
    <WorkspaceProvider projectId={1}>
      <JournalDetail projectId={1} entry={E} planLinks={[LINK]} onOpenDiff={vi.fn()} onOpenRelated={vi.fn()} />
    </WorkspaceProvider>,
  );
}

const copyButton = (c: HTMLElement) => [...c.querySelectorAll("button")].find((b) => b.textContent === t("diff.receipt.copy"))!;

describe("journal detail: one entry's receipt", () => {
  it("copies the entry's receipt with the same line shapes as the PR receipt", async () => {
    const { container } = renderDetail();
    fireEvent.click(copyButton(container));
    await waitFor(() => expect(clip.writeText).toHaveBeenCalledTimes(1));
    const md = clip.writeText.mock.calls[0][0];
    expect(md.split("\n")[0]).toBe(`### ${t("diff.receipt.title")} · Shell: names clashed`);
    // 걸린 계획의 마지막 결과 — 화면이 아는 연결로(오늘 집계에 아직 없어도).
    expect(md).toContain(`- ✗ ${t("diff.receipt.plan", { plan: "Plan P" })} — \`pnpm test\` → 2 failed`);
    // 검증 칸의 끝 줄이 그대로.
    expect(md).toContain("- ✓ Shell: names clashed — pnpm test → 3 passed");
    expect(md.trimEnd().endsWith(`<sub>${t("diff.receipt.footer")}</sub>`)).toBe(true);
    expect(toast.info).toHaveBeenCalledWith(t("diff.receipt.copied"));
  });

  it("copies the same receipt with ⇧⌘C (Ctrl+Shift+C elsewhere)", async () => {
    renderDetail();
    fireEvent.keyDown(window, { key: "C", code: "KeyC", metaKey: true, ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(clip.writeText).toHaveBeenCalledTimes(1));
    expect(clip.writeText.mock.calls[0][0]).toContain("Shell: names clashed");
  });

  it("saves one self-contained HTML file from the ▾ menu", async () => {
    const { container } = renderDetail();
    fireEvent.click(container.querySelector(".rcpt-more")!);
    const item = [...container.querySelectorAll('[role="menuitem"]')].find((b) => b.textContent === t("diff.receipt.saveHtml"))!;
    fireEvent.click(item);
    await waitFor(() => expect(saved.calls).toHaveLength(1));
    const { name, html } = saved.calls[0];
    expect(name).toBe("ocul-receipt-Shell-names-clashed.html");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<h1>Ocul receipt · Shell: names clashed</h1>");
    expect(html).toContain('<li class="fail">');
    expect(html).not.toMatch(/<script|<link|<img|https?:\/\//i);
    expect(html).toContain("default-src 'none'");
    expect(toast.info).toHaveBeenCalledWith(t("diff.receipt.saved", { path: "/tmp/receipt.html" }));
    expect(container.querySelector(".rcpt-menu")).toBeNull();
  });
});

describe("today and diff share the branch receipt button", () => {
  it("copies the branch receipt by click and by ⇧⌘C", async () => {
    const { container } = render(<BranchReceiptButton projectId={1} />);
    fireEvent.click(copyButton(container));
    await waitFor(() => expect(clip.writeText).toHaveBeenCalledTimes(1));
    expect(clip.writeText.mock.calls[0][0]).toContain("`feat/x` ← `main`");
    fireEvent.keyDown(window, { key: "c", code: "KeyC", metaKey: true, ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(clip.writeText).toHaveBeenCalledTimes(2));
  });

  it("leaves the key alone while a dialog is open, and hears only ⇧⌘C", async () => {
    render(<BranchReceiptButton projectId={1} />);
    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    document.body.appendChild(dialog);
    fireEvent.keyDown(window, { key: "c", code: "KeyC", metaKey: true, ctrlKey: true, shiftKey: true });
    dialog.remove();
    await new Promise((r) => setTimeout(r, 20));
    expect(clip.writeText).not.toHaveBeenCalled();
    const ev = (o: Partial<KeyboardEventInit>) => new KeyboardEvent("keydown", { key: "c", code: "KeyC", ...o });
    expect(isReceiptChord(ev({ metaKey: true, ctrlKey: true }))).toBe(false);
    expect(isReceiptChord(ev({ metaKey: true, ctrlKey: true, shiftKey: true, altKey: true }))).toBe(false);
  });
});

describe("one format", () => {
  it("reads the last verification line like the backend (list marks, backticks, 120 chars)", () => {
    expect(proofLine("## Verification\n- `cargo test` 3 passed\n- `pnpm lint` exit 0\n")).toBe("pnpm lint exit 0");
    expect(proofLine("## Summary\nno verification\n")).toBeNull();
    const long = proofLine(`## Verification\n${"x".repeat(130)}\n`)!;
    expect([...long]).toHaveLength(121);
    expect(long.endsWith("…")).toBe(true);
  });

  it("says when the entry has no command run, and caps the file list", () => {
    const files = Array.from({ length: 23 }, (_, i) => `src/f${i}.ts`);
    const md = journalReceiptMarkdown(
      { entry: { ...E, evidence: 1 }, body: "## Verification\nlooked at it\n", files },
      null,
      t,
    );
    expect(md).toContain(`- · Shell: names clashed — ${t("diff.receipt.noProof")}`);
    expect(md).toContain(`**${t("diff.receipt.files", { n: 23 })}**`);
    expect(md).toContain(`- ${t("diff.receipt.more", { n: 3 })}`);
    expect(md).not.toContain(t("diff.receipt.plans"));
  });

  it("escapes every character a journal could carry before it becomes HTML", () => {
    expect(escapeHtml(`<script>"x"&'y'</script>`)).toBe("&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;");
    const body = receiptBodyHtml("### Ocul receipt · <img src=x>\n\n**Plans**\n- ✓ ok `a<b`\n- ✓ passed · ⚠ 2 files changed after\n");
    expect(body).toContain("<h1>Ocul receipt · &lt;img src=x&gt;</h1>");
    expect(body).toContain("<h2>Plans</h2>");
    expect(body).toContain('<li class="ok">✓ ok <code>a&lt;b</code></li>');
    expect(body).toContain('<li class="warn">');
    expect(receiptHtmlDocument("x", "T", "ko")).toContain('<html lang="ko">');
    expect(receiptFileName("### Ocul receipt · `feat/x` ← `main`", "ocul-receipt")).toBe("ocul-receipt-feat-x-main.html");
  });
});
