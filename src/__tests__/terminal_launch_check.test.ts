// 「다음」 실행 뒤 claude 를 못 찾았는가 (ocul-next #launch-fail) — 셸마다 다른 말.
import { describe, expect, it } from "vitest";

import { launchFailed } from "@/features/terminal/launchCheck";

describe("claude 를 못 찾음", () => {
  it.each([
    ["zsh", "zsh: command not found: claude\r\n"],
    ["bash", "bash: claude: command not found\r\n"],
    ["dash", "sh: 1: claude: not found\r\n"],
    ["fish", "fish: Unknown command: claude\r\n"],
    ["PowerShell", "claude: The term 'claude' is not recognized as a name of a cmdlet"],
  ])("%s 의 말을 알아본다", (_shell, text) => {
    expect(launchFailed(`~/code/app % claude "$OCULPM_PROMPT"\r\n${text}`)).toBe(true);
  });

  it("claude 가 뜬 화면이나 다른 명령의 「없음」은 아니다", () => {
    expect(launchFailed("╭─ Claude Code ─╮\r\n> 다음 항목을 잡아")).toBe(false);
    expect(launchFailed("zsh: command not found: claudex\r\n")).toBe(false);
    expect(launchFailed("bash: pnpm: command not found\r\n")).toBe(false);
  });
});
