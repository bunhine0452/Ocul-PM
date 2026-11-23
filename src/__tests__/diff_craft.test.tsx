// 변경 화면 다듬기 (11-23 love-round G2) — 빈 화면의 영수증 · 파일 동사 하나 · 줄 메모 표적.
//
// - 올릴 것이 없는(커밋 전 변경도 직전 커밋도 없는) 화면에 「영수증 복사」 가 살아 있으면 빈 영수증이 클립보드에 들어갔다.
// - 파일을 Claude 에게 보내는 단추가 「이 파일 맡기기」 라, 위 띠의 「일지 맡기기」 와 같은 동사였다 — 일지 상세와 같은
//   「Claude 에게 보내기」 로.
// - 줄 메모 「+」 는 16px 강조색 사각형이었다 — 표적은 24px, 색은 --text-2 (강조색은 채운 단추 · 포커스에만).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, waitFor } from "@testing-library/react";

vi.mock("@/lib/bindings", async () => (await import("./helpers/diffFx")).bindingsMock());
vi.mock("@/features/terminal/sendToClaude", async () => (await import("./helpers/diffFx")).sendMock());

import { t } from "@/i18n";
import { entryGroup, fx, renderDiffScreen, resetFx, seed } from "./helpers/diffScreenFx";

beforeEach(resetFx);
afterEach(cleanup);

const receiptButton = (el: HTMLElement) =>
  [...el.querySelectorAll("button")].find((b) => b.textContent === t("diff.receipt.copy")) ?? null;

describe("receipt on an empty diff", () => {
  it("has no receipt button when there is nothing to hand in", async () => {
    const { container } = renderDiffScreen();
    await waitFor(() => expect(container.textContent).toContain(t("diff.emptyBranch")));
    expect(receiptButton(container)).toBeNull();
  });

  it("keeps it when the last commit has changes (the branch has something to show)", async () => {
    fx.lastCommit = { sha: "a1b2c3d4", short_sha: "a1b2c3d", subject: "ship", changes: [{ path: "src/old.ts", op: "M" }] };
    const { container } = renderDiffScreen();
    await waitFor(() => expect(container.textContent).toContain("a1b2c3d"));
    expect(receiptButton(container)).not.toBeNull();
  });

  it("keeps it when there are changes", async () => {
    fx.groups = [entryGroup("20260820/Bugs/1000_bug_a.md", "one", ["src/a.ts"])];
    seed([{ path: "src/a.ts", op: "M" }]);
    const { container } = renderDiffScreen();
    await waitFor(() => expect(container.querySelector(".chg-fh")).not.toBeNull());
    expect(receiptButton(container)).not.toBeNull();
  });
});

describe("one verb per meaning", () => {
  it("the file head sends the file with the app-wide 「Claude 에게 보내기」, never a second 「맡기기」", async () => {
    fx.groups = [entryGroup("20260820/Bugs/1000_bug_a.md", "one", ["src/a.ts"])];
    seed([{ path: "src/a.ts", op: "M" }]);
    const { container } = renderDiffScreen();
    await waitFor(() => expect(container.querySelector(".chg-fh-act")?.textContent).toContain(t("diff.viewed")));
    const labels = [...container.querySelectorAll(".chg-fh-act button")].map((b) => b.textContent);
    expect(labels).toContain(t("send.title"));
    expect(labels.some((l) => l?.includes("맡기기"))).toBe(false);
  });
});

describe("line-note target", () => {
  const css = readFileSync(join(__dirname, "..", "styles/screens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, " ");
  const rule = (sel: string) => new RegExp(`(^|\\n)${sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[2] ?? "";

  it("is 24px wide and the full row tall, and carries no accent colour", () => {
    const add = rule(".dl-note-add");
    expect(add).toMatch(/width:\s*24px/);
    expect(add).toMatch(/top:\s*0;\s*bottom:\s*0/);
    expect(add).not.toMatch(/--accent/);
    expect(rule(".dl-note-add.has::before")).toMatch(/border:\s*1px solid var\(--text-2\)/);
  });

  it("hidden buttons take no pointer (no overlapping targets) but stay reachable by Tab", () => {
    expect(rule(".dl-note-add")).toMatch(/pointer-events:\s*none/);
    expect(css).toMatch(/\.dl-note-add:focus-visible, \.dl-note-add\.has \{[^}]*opacity:\s*1;[^}]*pointer-events:\s*auto/);
  });
});
