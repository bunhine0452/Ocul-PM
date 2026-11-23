// git 저장소가 아니거나 git 이 없으면 변경 화면이 「변경이 없어요」 가 아니라 「볼 수 없어요」 라고 말한다
// (love-round #diff-non-git, 11-23). 볼 수 없는 것을 「없음」 으로 말하던 자리.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";

const repo = vi.hoisted(() => ({ state: { is_git_repo: false, git_missing: false } as unknown }));
const opened = vi.hoisted(() => [] as string[]);

vi.mock("@/lib/bindings", async () => {
  const base = (await import("./helpers/diffFx")).bindingsMock();
  return {
    ...base,
    commands: new Proxy(base.commands, {
      get: (target, prop) => {
        if (prop === "gitStatus") return () => Promise.resolve({ status: "ok", data: repo.state });
        if (prop === "openUrl")
          return (url: string) => {
            opened.push(url);
            return Promise.resolve({ status: "ok", data: null });
          };
        return (target as Record<string | symbol, unknown>)[prop];
      },
    }),
  };
});
vi.mock("@/features/terminal/sendToClaude", async () => (await import("./helpers/diffFx")).sendMock());

import { t } from "@/i18n";
import { renderDiffScreen, resetFx } from "./helpers/diffScreenFx";

beforeEach(() => {
  resetFx();
  opened.length = 0;
});
afterEach(cleanup);

describe("diff screen without a repository", () => {
  it("says the folder is not a git repo instead of 「no changes」, with git init to copy", async () => {
    repo.state = { is_git_repo: false, git_missing: false, head_branch: null, remotes: [] };
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { container, getByRole } = renderDiffScreen();
    await waitFor(() => expect(container.textContent).toContain(t("diff.noRepo")));
    expect(container.textContent).not.toContain(t("diff.emptyBranch"));
    fireEvent.click(getByRole("button", { name: t("diff.noRepo.action") }));
    expect(writeText).toHaveBeenCalledWith("git init");
  });

  it("says git itself is missing, and the one action opens the install guide", async () => {
    repo.state = { is_git_repo: false, git_missing: true, head_branch: null, remotes: [] };
    const { container, getByRole } = renderDiffScreen();
    await waitFor(() => expect(container.textContent).toContain(t("diff.noGit")));
    fireEvent.click(getByRole("button", { name: t("diff.noGit.action") }));
    await waitFor(() => expect(opened).toEqual(["https://git-scm.com/downloads"]));
  });

  it("a real repo with nothing changed still says there are no changes", async () => {
    repo.state = { is_git_repo: true, git_missing: false, head_branch: "main", remotes: [] };
    const { container } = renderDiffScreen();
    await waitFor(() => expect(container.textContent).toContain(t("diff.emptyBranch")));
    expect(container.textContent).not.toContain(t("diff.noRepo"));
  });
});
