// claude 를 못 찾았다는 감지가 셸 언어와 무관하다 (love-round #launch-fail-any-locale, 11-23).
// 영어 문장 다섯 개뿐이라 한국어 bash · 한국어 PowerShell · 실행 정책에 막힌 claude.ps1 은 하나도 안 잡혔고, 잡혀도
// 토스트에 할 일이 없었다. POSIX 셸은 종료 코드 127 의 표지(OSC 6973)로 언어와 상관없이 잡는다.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "@/i18n";
import { __setPlatformForTests } from "@/lib/platform";
import { dismissToast, getToasts } from "@/lib/toast";
import {
  LAUNCH_MISSING_MARK,
  announceLaunchFailure,
  launchFailed,
  launchFailure,
} from "@/features/terminal/launchCheck";

const LINE = '~/code/app % claude "$OCULPM_PROMPT"\r\n';

beforeEach(() => {
  for (const toast of getToasts()) dismissToast(toast.id);
  __setPlatformForTests(null);
});

describe("launchFailure", () => {
  it("reads the exit-127 mark whatever language the shell spoke", () => {
    // 독일어 bash — 패턴이 하나도 없는 언어.
    const head = `${LINE}bash: claude: Befehl nicht gefunden.\r\n${LAUNCH_MISSING_MARK}$ `;
    expect(launchFailure(head)).toBe("missing");
  });

  it.each([
    // i18n-ignore-next-line -- 셸의 오류 문구(검사 재료)
    ["bash ko", "bash: claude: 명령어를 찾을 수 없음\r\n"],
    // i18n-ignore-next-line -- 셸의 오류 문구(검사 재료)
    ["PowerShell ko", "claude : 'claude' 용어가 cmdlet, 함수, 스크립트 파일 또는 실행할 수 있는 프로그램 이름으로 인식되지 않습니다."],
    ["PowerShell 5.1 any language", "    + FullyQualifiedErrorId : CommandNotFoundException\r\n"],
  ])("%s → missing", (_name, text) => {
    expect(launchFailure(`${LINE}${text}`)).toBe("missing");
  });

  it.each([
    [
      "en",
      "claude : File C:\\Users\\me\\AppData\\Roaming\\npm\\claude.ps1 cannot be loaded because running scripts is disabled on this system.",
    ],
    // i18n-ignore-next-line -- 셸의 오류 문구(검사 재료)
    ["ko", "claude : 이 시스템에서 스크립트를 실행할 수 없으므로 C:\\Users\\me\\AppData\\Roaming\\npm\\claude.ps1 파일을 로드할 수 없습니다."],
  ])("execution policy (%s) → blocked, not missing", (_lang, text) => {
    expect(launchFailure(`${LINE}${text}`)).toBe("blocked");
  });

  it("stays quiet when claude started or another command was missing", () => {
    expect(launchFailure("╭─ Claude Code ─╮\r\n> next")).toBeNull();
    // i18n-ignore-next-line -- 셸의 오류 문구(검사 재료)
    expect(launchFailure("bash: pnpm: 명령어를 찾을 수 없음\r\n")).toBeNull();
    expect(launchFailure("\x1b]6973;something-else\x07")).toBeNull();
    expect(launchFailed("bash: claudex: command not found\r\n")).toBe(false);
  });
});

describe("announceLaunchFailure", () => {
  it("carries one thing to do: copy the installer line for this OS", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    __setPlatformForTests("windows");
    announceLaunchFailure("missing");
    const [toast] = getToasts();
    expect(toast.message).toBe(t("terminal.launchFailed"));
    expect(toast.actions?.map((a) => a.label)).toEqual([t("terminal.launchCopyInstall")]);
    toast.actions?.[0].onClick();
    expect(writeText).toHaveBeenCalledWith("irm https://claude.ai/install.ps1 | iex");
  });

  it("names the execution policy when PowerShell blocked claude.ps1", () => {
    announceLaunchFailure("blocked");
    expect(getToasts().map((x) => x.message)).toContain(t("terminal.launchBlocked"));
  });
});
