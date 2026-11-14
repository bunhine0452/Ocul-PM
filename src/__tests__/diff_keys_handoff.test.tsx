// 일지에서 넘어오면 그 일지 묶음 · 알린 키 = 듣는 키 (11-15 #diff-keys-handoff, DF-02).
//
// 일지 상세는 일지 경로(20260820/…/x.md)를 파일 자리에 실어 보낸다 — 받는 쪽이 가른다. 키는 화면 루트가
// 듣고, 치트시트의 DIFF 묶음이 그 표를 그대로 옮긴다: 행마다 키를 보내 화면이 반응해야 한다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/bindings", async () => (await import("./helpers/diffFx")).bindingsMock());
vi.mock("@/features/terminal/sendToClaude", async () => (await import("./helpers/diffFx")).sendMock());

import { saveNote, startNote } from "@/features/diff/diffNoteStore";
import { t } from "@/i18n";
import { buildShortcutGroups } from "@/lib/shortcutRegistry";
import { getToasts } from "@/lib/toast";
import { recentChangesStore } from "@/lib/recentChangesStore";
import { activeName, entryGroup, fx, looseGroup, renderDiffScreen, resetFx, seed, summaryOf } from "./helpers/diffScreenFx";

const TWO_HUNKS = [
  "diff --git a/src/w1.ts b/src/w1.ts",
  "@@ -1,2 +1,2 @@",
  " a",
  "-b",
  "+B",
  "@@ -20,2 +20,2 @@",
  " x",
  "-y",
  "+Y",
].join("\n");

let scrolled: Element[] = [];
beforeEach(() => {
  resetFx();
  scrolled = [];
  Element.prototype.scrollIntoView = function (this: Element) {
    scrolled.push(this);
  };
});
afterEach(cleanup);

/** 일지 둘(파일 셋) + 일지 없는 파일 하나. `missing` 이면 첫 일지가 검증 없음(처음 펼쳐진다). */
function seedMixed(extra: Record<string, unknown> = {}, missing = false) {
  fx.groups = [
    entryGroup("20260820/Bugs/1000_bug_a.md", "watch race", ["src/w1.ts", "src/w2.ts"]),
    entryGroup("20260820/Features_to_add/0900_feature_b.md", "drop automation", ["src/auto.ts"]),
    looseGroup(["src/loose.ts"]),
  ];
  if (missing) fx.brief = [summaryOf("20260820/Bugs/1000_bug_a.md", 0), summaryOf("20260820/Features_to_add/0900_feature_b.md", 2)];
  for (const p of ["src/w1.ts", "src/w2.ts"]) {
    fx.diffByPath[p] = { path: p, source: { source: "git", patch: TWO_HUNKS.replace(/w1/g, p.slice(4, 6)) }, truncated: null };
  }
  seed(["src/w1.ts", "src/w2.ts", "src/auto.ts", "src/loose.ts"].map((path) => ({ path, op: "M" as const })), extra);
}

describe("handoff from a journal entry", () => {
  it("opens that entry's group and picks its first file", async () => {
    seedMixed({ diffActivePath: "20260820/Bugs/1000_bug_a.md" });
    const { container } = renderDiffScreen();
    await waitFor(() => expect(activeName(container)).toBe("src/w1.ts"));
    const grp = [...container.querySelectorAll(".chg-grp")].find((g) => g.textContent?.includes("watch race"))!;
    expect(grp.getAttribute("aria-expanded")).toBe("true");
  });

  it("falls back to the entry's files_touched in the changes", async () => {
    seedMixed({ diffActivePath: "20260819/Bugs/old.md" });
    fx.journal = { frontmatter: { files_touched: [{ path: "src/gone.ts" }, { path: "src/auto.ts" }] } };
    const { container } = renderDiffScreen();
    await waitFor(() => expect(activeName(container)).toBe("src/auto.ts"));
  });

  it("says so when none of the entry's files are in the changes", async () => {
    seedMixed({ diffActivePath: "20260819/Bugs/old.md" });
    fx.journal = { frontmatter: { files_touched: [{ path: "src/gone.ts" }] } };
    renderDiffScreen();
    await waitFor(() => expect(getToasts().some((x) => x.message === t("diff.handoffMissing"))).toBe(true));
  });
});

describe("focus", () => {
  it("lands on the list the moment it first appears — j works after the watcher fills it", async () => {
    const { container } = renderDiffScreen();
    await waitFor(() => expect(container.textContent).toContain(t("diff.emptyBranch")));
    act(() => {
      recentChangesStore.push(1, { path: "src/a.ts", op: "M", ts: 1, read: false });
      recentChangesStore.push(1, { path: "src/b.ts", op: "M", ts: 2, read: false });
    });
    await waitFor(() => expect(activeName(container)).toBe("src/b.ts"));
    expect(document.activeElement?.classList.contains("chg-split")).toBe(true);
    fireEvent.keyDown(document.activeElement!, { key: "j" });
    await waitFor(() => expect(activeName(container)).toBe("src/a.ts"));
  });
});

describe("keys the cheatsheet promises are keys the screen hears", () => {
  const press = (el: Element, keys: string) => {
    const alt = keys.startsWith("⌥");
    const key = alt ? keys.slice(1) : keys;
    fireEvent.keyDown(el, { key, altKey: alt, code: alt ? "Key" + key.toUpperCase() : undefined });
  };

  it("n scrolls to the next hunk head", async () => {
    seedMixed();
    const { container } = renderDiffScreen();
    await waitFor(() => expect(activeName(container)).toBe("src/loose.ts"));
    fireEvent.click(container.querySelector(".chg-grp")!);
    fireEvent.click([...container.querySelectorAll(".chg-item.nested")].find((r) => r.textContent?.includes("w1"))!);
    await waitFor(() => expect(container.querySelectorAll(".diff-code .hunk-head")).toHaveLength(2));
    scrolled = [];
    press(container.querySelector(".chg-split")!, "n");
    expect(scrolled).toEqual([container.querySelectorAll(".diff-code .hunk-head")[1]]);
  });

  it("every DIFF row changes something on screen", async () => {
    seedMixed({}, true);
    const { container } = renderDiffScreen();
    await waitFor(() => expect(activeName(container)).toBe("src/loose.ts"));
    const split = () => container.querySelector(".chg-split")!;
    const rows = buildShortcutGroups().find((g) => g.id === "diff")!.rows;
    const checks: Record<string, () => Promise<void>> = {
      "keys.diffFiles": async () => {
        // 일지 없음 → (검증 없는 묶음은 처음 펼쳐진다) 다음 파일.
        const before = activeName(container);
        press(split(), "j");
        await waitFor(() => expect(activeName(container)).not.toBe(before));
      },
      "keys.diffGroups": async () => {
        press(split(), "]");
        await waitFor(() => expect(activeName(container)).toBe("src/auto.ts"));
        press(split(), "[");
        await waitFor(() => expect(activeName(container)).toBe("src/w1.ts"));
      },
      "keys.diffHunks": async () => {
        await waitFor(() => expect(container.querySelectorAll(".diff-code .hunk-head")).toHaveLength(2));
        scrolled = [];
        press(split(), "n");
        expect(scrolled).toHaveLength(1);
        press(split(), "p");
        expect(scrolled).toHaveLength(2);
      },
      "keys.diffNextNote": async () => {
        act(() => {
          startNote(1, { file: "src/w1.ts", side: "new", line: 2, code: "B" });
          saveNote(1, "rename");
        });
        await waitFor(() => expect(container.querySelector(".diff-code .dl-note")).not.toBeNull());
        scrolled = [];
        press(split(), "⌥n");
        expect(scrolled).toEqual([container.querySelector(".diff-code .dl-note")]);
      },
      "keys.diffViewed": async () => {
        press(split(), "v");
        await waitFor(() => expect(container.querySelector('.chg-item[aria-current="true"]')?.classList.contains("is-viewed")).toBe(true));
      },
      "keys.diffEditor": async () => {
        press(split(), "e");
        await waitFor(() => expect(fx.openInEditor).toHaveBeenCalledWith("/tmp/proj", "src/w1.ts", expect.any(String), 2));
      },
    };
    expect(rows.map((r) => r.labelKey).sort()).toEqual(Object.keys(checks).sort());
    for (const r of rows) await checks[r.labelKey]();
  });
});

describe("baseline and view segments", () => {
  it("are radio groups that move with the arrow keys", async () => {
    seedMixed();
    fx.lastCommit = { sha: "a1b2c3d4", short_sha: "a1b2c3d", subject: "ship", changes: [{ path: "src/old.ts", op: "M" }] };
    const { container, getByRole } = renderDiffScreen();
    await waitFor(() => expect(activeName(container)).toBe("src/loose.ts"));
    const view = getByRole("radiogroup", { name: t("diff.viewAria") });
    const radios = view.querySelectorAll('[role="radio"]');
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    expect(radios[1].getAttribute("tabindex")).toBe("-1");
    fireEvent.keyDown(radios[0], { key: "ArrowRight" });
    await waitFor(() => expect(container.querySelector(".dl.split")).not.toBeNull());
    expect(getByRole("radiogroup", { name: t("diff.modeTitle") })).toBeTruthy();
  });
});
