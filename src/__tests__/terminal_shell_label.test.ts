/**
 * 새 터미널 탭의 기본 라벨 = 실제 셸 이름 (크로스플랫폼 라운드 {#ui-e2e-minor}).
 *
 * Linux E2E 에서 bash 가 도는 탭이 "zsh" 로 적혀 있었고(TerminalSurface 하드코딩),
 * Windows 에서는 콘솔이 제목으로 보낸 실행 파일 경로가 `C:\Program Files\PowerS…` 로
 * 잘려 탭 이름이 됐다. macOS 는 예전 그대로 "zsh" 다 (D3).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const shellIntegrationStatus = vi.fn();
vi.mock("@/lib/bindings", () => ({
  commands: { shellIntegrationStatus: () => shellIntegrationStatus() },
}));

import {
  __resetShellNameForTests,
  fallbackShellName,
  loadShellName,
  relabelDefaultTabs,
  shellNameFromStatus,
} from "@/features/terminal/shellName";
import { canAutoRename, shellTitleToTabLabel } from "@/features/terminal/tabTitle";
import { __setPlatformForTests } from "@/lib/platform";
import type { TerminalTab } from "@/contexts/WorkspaceContext";

const status = (shell: string, rc_path = "") => ({ shell: shell as never, rc_path });
const tab = (label: string): TerminalTab => ({ id: label, label, shell: "", cwd: "" });

beforeEach(() => {
  __resetShellNameForTests();
  shellIntegrationStatus.mockReset();
});

describe("shellNameFromStatus", () => {
  it("mac always says zsh — the label never changes there", () => {
    expect(shellNameFromStatus(status("bash", "/Users/me/.bashrc"), "mac")).toBe("zsh");
    expect(fallbackShellName("mac")).toBe("zsh");
  });

  it("linux names the shell the app launches", () => {
    expect(shellNameFromStatus(status("bash", "/home/me/.bashrc"), "linux")).toBe("bash");
    expect(shellNameFromStatus(status("zsh", "/home/me/.zshrc"), "linux")).toBe("zsh");
    expect(shellNameFromStatus(status("powershell", "/home/me/.config/powershell/profile.ps1"), "linux")).toBe("pwsh");
    expect(shellNameFromStatus(status("unsupported"), "linux")).toBe("shell");
    expect(fallbackShellName("linux")).toBe("bash");
  });

  it("windows tells the two PowerShell editions apart by profile folder", () => {
    const docs = "C:\\Users\\me\\OneDrive\\Documents";
    expect(shellNameFromStatus(status("powershell", `${docs}\\PowerShell\\profile.ps1`), "windows")).toBe("pwsh");
    expect(shellNameFromStatus(status("powershell", `${docs}\\WindowsPowerShell\\profile.ps1`), "windows")).toBe(
      "powershell",
    );
    expect(shellNameFromStatus(status("powershell", ""), "windows")).toBe("powershell");
    expect(shellNameFromStatus(status("unsupported"), "windows")).toBe("cmd");
    expect(fallbackShellName("windows")).toBe("powershell");
  });
});

describe("loadShellName", () => {
  it("asks once and remembers", async () => {
    __setPlatformForTests("linux");
    shellIntegrationStatus.mockResolvedValue({ status: "ok", data: status("bash", "/home/me/.bashrc") });
    expect(await loadShellName()).toBe("bash");
    expect(await loadShellName()).toBe("bash");
    expect(shellIntegrationStatus).toHaveBeenCalledTimes(1);
  });

  it("falls back to the platform default when the status call fails", async () => {
    __setPlatformForTests("windows");
    shellIntegrationStatus.mockRejectedValue("no backend");
    expect(await loadShellName()).toBe("powershell");
  });
});

describe("relabelDefaultTabs", () => {
  it("renames only default labels, keeping the tab number", () => {
    __setPlatformForTests("linux");
    const tabs = [tab("zsh"), tab("zsh 2"), tab("my build"), tab("Claude Code")];
    expect(relabelDefaultTabs(tabs, "bash").map((t) => t.label)).toEqual(["bash", "bash 2", "my build", "Claude Code"]);
  });

  it("returns the same array when nothing changes (no re-render)", () => {
    __setPlatformForTests("linux");
    const tabs = [tab("bash"), tab("notes")];
    expect(relabelDefaultTabs(tabs, "bash")).toBe(tabs);
  });

  it("does nothing on mac, even for a hand-named 'fish' tab", () => {
    const tabs = [tab("fish"), tab("zsh 2")];
    expect(relabelDefaultTabs(tabs, "bash", "mac")).toBe(tabs);
  });
});

describe("canAutoRename — which labels a shell title may replace", () => {
  it("mac keeps the old table", () => {
    expect(canAutoRename("zsh 2")).toBe(true);
    expect(canAutoRename("pwsh")).toBe(false);
    expect(canAutoRename("cmd")).toBe(false);
  });
  it("windows/linux also treat the new default names as default", () => {
    for (const p of ["windows", "linux"] as const) {
      __setPlatformForTests(p);
      for (const label of ["pwsh", "powershell 2", "cmd", "bash 3", "shell"]) {
        expect(canAutoRename(label)).toBe(true);
      }
      expect(canAutoRename("my build")).toBe(false);
    }
  });
});

describe("shellTitleToTabLabel — Windows console titles", () => {
  it("shortens an executable path to the program name", () => {
    __setPlatformForTests("windows");
    expect(shellTitleToTabLabel("C:\\Program Files\\PowerShell\\7\\pwsh.exe")).toBe("pwsh");
    expect(shellTitleToTabLabel("C:\\WINDOWS\\system32\\WindowsPowerShell\\v1.0\\powershell.exe")).toBe("powershell");
    expect(shellTitleToTabLabel("C:\\WINDOWS\\system32\\cmd.exe - npm test")).toBe("cmd - npm test");
    expect(shellTitleToTabLabel("D:\\a\\_temp\\fixture\\e2e-fixture")).toBe("e2e-fixture");
    expect(shellTitleToTabLabel("npm run dev")).toBe("npm run dev");
  });
  it("mac is unchanged", () => {
    expect(shellTitleToTabLabel("kim@mac: ~/src/ai-pm")).toBe("ai-pm");
    expect(shellTitleToTabLabel("C:\\Program Files\\PowerShell\\7\\pwsh.exe")).toBe("C:\\Program Files\\PowerS…");
  });
});
