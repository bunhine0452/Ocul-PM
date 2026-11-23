// 변경: 「내가 본 뒤로」 (11-23 love-round L8 #p2-flow-review-checkpoint).
//
// 하루 동안 쌓인 변경에서 새로 바뀐 것만 보려면 파일마다 확인해야 했다 — 봤음이 앱 안에서만 살았고(다시 켜면
// 사라졌다) 본 파일도 제자리에 흐리게 남았다. 이제 본 파일은 끝의 「본 것 N」 한 줄로 접히고, 기록은
// WorkspaceContext 에 남아 다시 켠 뒤에도 그 뒤 바뀐 것만 펼친다. 열쇠는 파일 내용이다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/bindings", async () => (await import("./helpers/diffFx")).bindingsMock());
vi.mock("@/features/terminal/sendToClaude", async () => (await import("./helpers/diffFx")).sendMock());

import { storageKeyFor } from "@/contexts/WorkspaceContext";
import { resetDiffSession, viewStateOf } from "@/features/diff/diffSessionStore";
import { t } from "@/i18n";
import { recentChangesStore } from "@/lib/recentChangesStore";
import { activeName, entryGroup, fx, looseGroup, renderDiffScreen, resetFx, seed, summaryOf } from "./helpers/diffScreenFx";

beforeEach(resetFx);
afterEach(cleanup);

const B = "20260820/Bugs/1000_bug_b.md";
const FILES = ["src/b1.ts", "src/b2.ts", "src/b3.ts"];

/** 검증 없는 일지 하나에 파일 셋 — 처음 펼쳐지고 b1 을 고른다. */
function seedThree() {
  fx.groups = [entryGroup(B, "unchecked fix", FILES), looseGroup([])];
  fx.brief = [summaryOf(B, 0)];
  for (const f of FILES) fx.files.set(f, { ok: `content of ${f}` });
  seed(FILES.map((path) => ({ path, op: "M" as const })));
}

const row = (el: HTMLElement, path: string) => el.querySelector<HTMLElement>(`.chg-item[data-path="${path}"]`);
const split = (el: HTMLElement) => el.querySelector(".chg-split")!;
const seenRow = (el: HTMLElement) => el.querySelector<HTMLElement>(".chg-seen");
const saved = () => JSON.parse(localStorage.getItem(storageKeyFor(1)) ?? "{}").diffViewed as Record<string, { hash: string }> | undefined;

/** b1 을 봤음으로 하고 내용 해시까지 채워져 영속될 때까지. */
async function viewFirst(container: HTMLElement) {
  await waitFor(() => expect(activeName(container)).toBe("src/b1.ts"));
  fireEvent.keyDown(split(container), { key: "v" });
  await waitFor(() => expect(saved()?.["working\0src/b1.ts"]?.hash).toBeTruthy());
}

/** 앱을 껐다 켠다 — 창 안 기록은 비고 영속 값만 남는다. git 바탕 행은 변경 시각을 모른다(ts 0). */
function restart() {
  cleanup();
  resetDiffSession();
  recentChangesStore.clear();
  fx.uncommitted = FILES.map((path) => ({ path, op: "M" }));
}

describe("viewed files fold into one counted line", () => {
  it("keeps the picked file in place, then folds it into 'Viewed 1' once you move on", async () => {
    seedThree();
    const { container } = renderDiffScreen();
    await viewFirst(container);
    // 누른 줄은 눈앞에서 사라지지 않는다.
    expect(row(container, "src/b1.ts")?.classList.contains("is-viewed")).toBe(true);
    expect(seenRow(container)).toBeNull();
    fireEvent.keyDown(split(container), { key: "j" });
    await waitFor(() => expect(activeName(container)).toBe("src/b2.ts"));
    await waitFor(() => expect(row(container, "src/b1.ts")).toBeNull());
    expect(seenRow(container)?.textContent).toBe(`${t("diff.viewedHead")}1`);
    expect(seenRow(container)?.getAttribute("aria-expanded")).toBe("false");
    // 묶음의 수는 남은 것만.
    expect(container.querySelector(".chg-grp .chg-count")?.textContent).toBe("2");
    // 접힌 동안 j/k 는 본 파일을 지나지 않는다.
    fireEvent.keyDown(split(container), { key: "k" });
    expect(activeName(container)).toBe("src/b2.ts");
    // 펼치면 끝에 선다.
    fireEvent.click(seenRow(container)!);
    expect(row(container, "src/b1.ts")?.classList.contains("nested")).toBe(true);
  });

  it("folds a whole journal group once every file in it was viewed", async () => {
    seedThree();
    const { container } = renderDiffScreen();
    await waitFor(() => expect(activeName(container)).toBe("src/b1.ts"));
    for (const next of ["src/b2.ts", "src/b3.ts"]) {
      fireEvent.keyDown(split(container), { key: "v" });
      fireEvent.keyDown(split(container), { key: "j" });
      await waitFor(() => expect(activeName(container)).toBe(next));
    }
    fireEvent.keyDown(split(container), { key: "v" });
    // 고른 b3 만 제자리 — 그 묶음 줄은 남는다. 다른 데로 옮길 곳이 없으니 접힌 줄을 펼쳐 고르면 묶음째 접힌다.
    await waitFor(() => expect(seenRow(container)?.textContent).toBe(`${t("diff.viewedHead")}2`));
    fireEvent.click(seenRow(container)!);
    expect(container.querySelector(".chg-grp:not(.chg-seen)")).toBeNull();
    expect(seenRow(container)?.textContent).toBe(`${t("diff.viewedHead")}3`);
  });
});

describe("the checkpoint survives a restart", () => {
  it("remembers what you viewed and does not pick it first again", async () => {
    seedThree();
    const first = renderDiffScreen();
    await viewFirst(first.container);
    restart();
    const { container } = renderDiffScreen();
    await waitFor(() => expect(activeName(container)).toBe("src/b2.ts"));
    expect(row(container, "src/b1.ts")).toBeNull();
    expect(seenRow(container)?.textContent).toBe(`${t("diff.viewedHead")}1`);
  });

  it("opens the file again when its content changed while the app was closed", async () => {
    seedThree();
    const first = renderDiffScreen();
    await viewFirst(first.container);
    restart();
    fx.files.set("src/b1.ts", { ok: "edited while closed" });
    const { container } = renderDiffScreen();
    await waitFor(() => expect(row(container, "src/b1.ts")?.querySelector(".chg-changed")).toBeTruthy());
    expect(seenRow(container)).toBeNull();
  });

  it("keeps a mark it could not hash (binary) when you leave the screen and come back", async () => {
    seedThree();
    fx.files.set("src/b1.ts", { err: "stream did not contain valid UTF-8" });
    const first = renderDiffScreen();
    await waitFor(() => expect(activeName(first.container)).toBe("src/b1.ts"));
    fireEvent.keyDown(split(first.container), { key: "v" });
    await waitFor(() => expect(row(first.container, "src/b1.ts")?.classList.contains("is-viewed")).toBe(true));
    // 다른 화면에 갔다 온다 — 창의 런타임 기록은 남는다(앱을 다시 켠 게 아니다).
    cleanup();
    const { container } = renderDiffScreen();
    await waitFor(() =>
      expect(row(container, "src/b1.ts")?.classList.contains("is-viewed") || seenRow(container) != null).toBe(true),
    );
  });

  it("drops the record of a file that left the list (committed)", async () => {
    seedThree();
    const first = renderDiffScreen();
    await viewFirst(first.container);
    restart();
    fx.uncommitted = [{ path: "src/b2.ts", op: "M" }];
    renderDiffScreen();
    await waitFor(() => expect(saved()).toEqual({}));
  });
});

describe("the key is the file's content", () => {
  it("stays viewed when an agent rewrites the same content (only the time moved)", async () => {
    seedThree();
    const { container } = renderDiffScreen();
    await viewFirst(container);
    const reads = fx.reads.length;
    act(() => recentChangesStore.push(1, { path: "src/b1.ts", op: "M", ts: Date.now(), read: false }));
    await waitFor(() => expect(fx.reads.length).toBeGreaterThan(reads));
    await waitFor(() => expect(row(container, "src/b1.ts")?.classList.contains("is-viewed")).toBe(true));
    expect(row(container, "src/b1.ts")?.querySelector(".chg-changed")).toBeNull();
  });

  it("reads time only until the content is known, then the content wins", () => {
    const v = { hash: "aa", ts: 5 };
    const change = { path: "x", op: "M" as const, ts: 9, read: false };
    expect(viewStateOf(v, change, null)).toBe("changed");
    expect(viewStateOf(v, change, { hash: "aa", at: 9 })).toBe("viewed");
    expect(viewStateOf(v, change, { hash: "bb", at: 9 })).toBe("changed");
    // 읽은 뒤에 더 늦은 변경이 왔으면 낡은 읽음이다 — 시각으로.
    expect(viewStateOf(v, { ...change, ts: 12 }, { hash: "aa", at: 9 })).toBe("changed");
    expect(viewStateOf(undefined, change, null)).toBe("none");
  });
});
