// 변경: 볼 것이 없으면 그렇다고 말한다 (11-22).
//
// 파일 200개가 일지 40건에 묶여 선 날, 「일지 없음」 묶음이 없다는 것과 「검증 없음」 이 하나도 없다는 것은 묶음
// 메타 40줄을 다 훑어야 알 수 있었다. 예외가 없으면 목록 머리의 회색 ✓ 한 줄이 그것을 말한다 — 일지 없는 변경이
// 하나라도 있거나, 검증 없는 묶음이 있거나, 일지 요약을 못 읽었으면(모른다) 서지 않는다.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, waitFor } from "@testing-library/react";

vi.mock("@/lib/bindings", async () => (await import("./helpers/diffFx")).bindingsMock());
vi.mock("@/features/terminal/sendToClaude", async () => (await import("./helpers/diffFx")).sendMock());

import { t } from "@/i18n";
import { entryGroup, fx, looseGroup, renderDiffScreen, resetFx, seed, summaryOf } from "./helpers/diffScreenFx";

beforeEach(resetFx);
afterEach(cleanup);

const GROUPS = 40;
const PER_GROUP = 5;
const pathOf = (g: number) => `20260820/Features_to_add/${String(900 + g)}_feature_g${g}.md`;
const filesOf = (g: number) => Array.from({ length: PER_GROUP }, (_, i) => `src/g${g}/f${i}.ts`);

/** 파일 200개 · 일지 40건 — `evidenceOf(g)` 가 묶음마다의 증거 등급, `loose` 가 일지 없는 파일. */
function seedBig(evidenceOf: (g: number) => number, loose: string[] = []) {
  const groups = Array.from({ length: GROUPS }, (_, g) => entryGroup(pathOf(g), `work ${g}`, filesOf(g)));
  fx.groups = [...groups, looseGroup(loose)];
  fx.brief = groups.map((_, g) => summaryOf(pathOf(g), evidenceOf(g)));
  seed([...groups.flatMap((_, g) => filesOf(g)), ...loose].map((path) => ({ path, op: "M" as const })));
}

const clear = (el: HTMLElement) => el.querySelector(".chg-clear");
const heads = (el: HTMLElement) => el.querySelectorAll(".chg-grp");

describe("diff — nothing needs you", () => {
  it("200 files in 40 verified journals: one grey line says so, and the list is 40 folded heads", async () => {
    seedBig(() => 2);
    const { container } = renderDiffScreen();
    await waitFor(() => expect(heads(container)).toHaveLength(GROUPS));
    await waitFor(() => expect(clear(container)?.textContent).toBe(t("diff.allClear")));
    // 증거가 선 묶음은 한 줄로 접혀 선다 — 고른 파일의 묶음 하나만 펴진다.
    await waitFor(() => expect(container.querySelectorAll(".chg-item.nested")).toHaveLength(PER_GROUP));
    expect(container.querySelector(".chg-warn")).toBeNull();
  });

  it("stays silent when one journal has no verification", async () => {
    seedBig((g) => (g === 17 ? 0 : 2));
    const { container } = renderDiffScreen();
    await waitFor(() => expect(heads(container)).toHaveLength(GROUPS));
    await waitFor(() => expect(container.querySelector(".chg-warn")).not.toBeNull());
    expect(clear(container)).toBeNull();
  });

  it("stays silent when a change is in no journal", async () => {
    seedBig(() => 2, ["src/stray.ts"]);
    const { container } = renderDiffScreen();
    await waitFor(() => expect(heads(container)).toHaveLength(GROUPS));
    await waitFor(() => expect(container.textContent).toContain(t("diff.unrecorded.label")));
    expect(clear(container)).toBeNull();
  });

  it("stays silent when the journal summaries could not be read — unknown is not clear", async () => {
    seedBig(() => 2);
    fx.brief = [];
    const { container } = renderDiffScreen();
    await waitFor(() => expect(heads(container)).toHaveLength(GROUPS));
    // 요약이 없으면 「검증 없음」 도 서지 않는다 — 그렇다고 볼 것이 없다고 말하지는 않는다.
    await new Promise((r) => setTimeout(r, 400));
    expect(container.querySelector(".chg-warn")).toBeNull();
    expect(clear(container)).toBeNull();
  });
});
