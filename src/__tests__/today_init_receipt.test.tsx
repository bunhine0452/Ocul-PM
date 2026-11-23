// 첫 활성화 영수증 — 앱이 이 저장소에 쓴 것이 오늘의 「첫 기록까지」 카드에 닿는다 (love-round #init-receipt, 11-23).
// 보고(`oculpmInitCard`)는 저장됐지만 읽는 곳이 없어 개발자가 `git status` 에서 낯선 파일을 먼저 봤다.
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";

vi.mock("@/lib/bindings", async () => (await import("./todayFixture")).bindingsMock());
vi.mock("@/features/terminal/runPrompt", () => ({ runPromptInTerminal: async () => {} }));

import { useWorkspace, type OculpmInitCardInfo } from "@/contexts/WorkspaceContext";
import { initReceiptItems } from "@/features/today/InitReceipt";
import { __resetTodayStoreForTests } from "@/features/today/useTodayExceptions";
import { t } from "@/i18n";
import { entry, fx, resetFx } from "./todayFixture";
import { renderToday } from "./todayRender";

const REPORT: OculpmInitCardInfo = {
  createdDirs: [".oculpm"],
  wroteConfig: true,
  wroteGitignore: true,
  agentFiles: ["AGENTS.md", ".claude/CLAUDE.md"],
  at: 1,
};

function Seed({ info }: { info: OculpmInitCardInfo | null }) {
  const { setState } = useWorkspace();
  useEffect(() => setState((prev) => ({ ...prev, oculpmInitCard: info })), [info, setState]);
  return null;
}

beforeEach(() => resetFx());
afterEach(() => {
  cleanup();
  __resetTodayStoreForTests();
});

describe("first activation receipt", () => {
  it("names what the app wrote into the folder, file names in mono, at the foot of the first-steps card", async () => {
    fx.total = 0;
    const { container } = renderToday(<Seed info={REPORT} />);
    const card = await screen.findByRole("region", { name: t("today.first.title") });
    await waitFor(() => expect(card.querySelector(".tdy-init-receipt")).not.toBeNull());
    const line = card.querySelector(".tdy-init-receipt") as HTMLElement;
    expect(line.textContent).toContain(t("today.first.wrote"));
    expect([...line.querySelectorAll("code")].map((c) => c.textContent)).toEqual([
      ".oculpm/",
      "AGENTS.md",
      ".claude/CLAUDE.md",
      ".gitignore",
    ]);
    // 영수증은 채운 단추를 더하지 않는다 — 다음 걸음의 단추 하나만.
    expect(container.querySelectorAll(".btn.primary")).toHaveLength(1);
  });

  it("is gone once the first journal arrives (it lives inside the first-steps card)", async () => {
    fx.total = 3;
    fx.entries = [entry(1)];
    const { container } = renderToday(<Seed info={REPORT} />);
    await screen.findByRole("region", { name: t("today.work.title") });
    expect(container.querySelector(".tdy-init-receipt")).toBeNull();
  });

  it("says nothing on a re-open that wrote nothing", async () => {
    fx.total = 0;
    const { container } = renderToday(<Seed info={null} />);
    await screen.findByRole("region", { name: t("today.first.title") });
    expect(container.querySelector(".tdy-init-receipt")).toBeNull();
    expect(initReceiptItems({ ...REPORT, createdDirs: [], agentFiles: [], wroteGitignore: false })).toEqual([]);
  });
});
