// Windows PowerShell 5.1 에 && · || 로 이은 확인 명령 (love-round 11-23) — 백엔드가 셸을 띄우기 전에 거절하고
// (`terminal_env::ps51_chain`), 웹뷰는 「열지 못했어요」 에 묻지 않고 까닭과 고칠 길을 한 장으로 말한다.
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/api/invoke";
import { t } from "@/i18n";
import { toast } from "@/lib/toast";

const openTerm = vi.fn();
vi.mock("@/features/terminal/termStore", () => ({ openTerm: (...args: unknown[]) => openTerm(...args) }));

import { runCheckInTerminal } from "@/features/terminal/runCheck";

afterEach(() => {
  openTerm.mockReset();
  vi.restoreAllMocks();
});

describe("running a plan's check on Windows PowerShell 5.1", () => {
  it("names the reason and the fix in one warning, opens nothing, and does not throw", async () => {
    const warn = vi.spyOn(toast, "warning");
    openTerm.mockRejectedValue(
      new ApiError("term_open", { code: "check_ps51_chain", detail: "check: Windows PowerShell 5.1 does not understand && or ||" }),
    );
    await expect(runCheckInTerminal(1, "pnpm typecheck && pnpm test")).resolves.toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toBe(t("err.code.check_ps51_chain"));
    expect(warn.mock.calls[0][0]).toContain("PowerShell 7");
  });

  it("other failures still reach the caller's open-failed toast", async () => {
    const warn = vi.spyOn(toast, "warning");
    const err = new ApiError("term_open", { code: "terminal", detail: "spawn: no such file" });
    openTerm.mockRejectedValue(err);
    await expect(runCheckInTerminal(1, "pnpm test")).rejects.toBe(err);
    expect(warn).not.toHaveBeenCalled();
  });

  it("opens the session as before when the shell takes the line", async () => {
    openTerm.mockResolvedValue(7);
    await expect(runCheckInTerminal(1, "pnpm test")).resolves.toBe(7);
    expect(openTerm).toHaveBeenCalledWith(1, null, null, false, { line: "pnpm test", label: t("plan.check.session") });
  });
});
