/**
 * 「다음」 실행(`claude "<prompt>"`) 뒤 셸이 claude 를 못 찾았는가 (ocul-next #launch-fail,
 * Orca `agent-turn-idle-verdict` 참고). 못 찾았으면 셸만 남은 세션이다 — 「실행 중」으로 세지
 * 않는 것은 이미 된다(포그라운드가 셸이라 `busy` 가 거짓). 여기는 **알려 주는** 몫이다.
 *
 * 셸마다 말이 다르고, 같은 셸도 로캘마다 다르다 — 한국어 bash 의 「명령어를 찾을 수 없음」, 한국어 PowerShell 의
 * 「용어가 … 인식되지 않습니다」 는 영어 패턴 다섯에 하나도 안 걸려, 「터미널에서 맡기기」 를 눌러도 빈 셸만 남고
 * 아무 말이 없었다(love-round #launch-fail-any-locale, 11-23). 그래서 말보다 먼저 **종료 코드**를 본다: POSIX 셸과
 * fish 는 실행 줄 뒤에서 127 이면 화면에 안 그려지는 표지(`LAUNCH_MISSING_MARK`, `terminal_env.rs` 의
 * `MISSING_POSIX`)를 찍는다. 인자를 못 받아 쳐 넣는 셸(nushell · csh)과 PowerShell 은 표지가 없어 말로 본다.
 *
 * 세션 첫머리만 본다 — 그 뒤의 같은 글자는 claude 가 띄운 내용일 수 있다.
 */

import { t } from "@/i18n";
import { claudeCliInstall } from "@/lib/agentCommands";
import { getPlatform } from "@/lib/platform";
import { toast } from "@/lib/toast";

/** 셸 언어와 상관없는 표지 — 실행 줄 뒤 `$? == 127` 이면 셸이 찍는다(OSC 6973, xterm 은 그리지 않는다). */
export const LAUNCH_MISSING_MARK = "\x1b]6973;ocul-launch=127\x07";

const NOT_FOUND: readonly RegExp[] = [
  /command not found: claude\b/, // zsh
  /\bclaude: command not found/, // bash
  /\bclaude: not found/, // dash · sh
  /Unknown command: claude\b/, // fish
  /'claude' is not recognized/, // PowerShell · cmd
  // i18n-ignore-next-line -- 셸의 오류 문구(검사 재료)
  /\bclaude: 명령어를 찾을 수 없/, // 한국어 로캘 bash
  // i18n-ignore-next-line -- 셸의 오류 문구(검사 재료)
  /'claude' 용어가/, // 한국어 Windows PowerShell
  // i18n-ignore-next-line -- 셸의 오류 문구(검사 재료)
  /'claude'은\(는\) 내부 또는 외부 명령/, // 한국어 cmd
  /CommandNotFoundException/, // Windows PowerShell 5.1 — 어느 언어든 오류 꼬리에 이 이름이 남는다
];

/** npm 으로 깐 `claude.ps1` 을 PowerShell 실행 정책이 막았다 — claude 는 있는데 돌지 못한다. */
const BLOCKED: readonly RegExp[] = [
  /claude\.ps1[\s\S]{0,240}running scripts is disabled/,
  // i18n-ignore-next-line -- 셸의 오류 문구(검사 재료)
  /스크립트를 실행할 수 없으므로[\s\S]{0,240}claude\.ps1/,
  // i18n-ignore-next-line -- 셸의 오류 문구(검사 재료)
  /claude\.ps1[\s\S]{0,240}스크립트를 실행할 수 없/,
];

/** 세션 첫머리로 볼 만큼 — 셸 프롬프트 · 프로필 출력까지 넉넉히. */
export const LAUNCH_WATCH_CHARS = 4096;

export type LaunchFailure = "missing" | "blocked";

export function launchFailure(head: string): LaunchFailure | null {
  if (BLOCKED.some((re) => re.test(head))) return "blocked";
  if (head.includes(LAUNCH_MISSING_MARK) || NOT_FOUND.some((re) => re.test(head))) return "missing";
  return null;
}

export function launchFailed(head: string): boolean {
  return launchFailure(head) !== null;
}

/** 못 찾았다 · 막혔다를 말하고, 할 일 하나(설치 줄 복사)를 단다 — 예전 토스트에는 할 일이 없었다. */
export function announceLaunchFailure(failure: LaunchFailure): void {
  const lines = claudeCliInstall(getPlatform() === "windows");
  toast.warning(t(failure === "blocked" ? "terminal.launchBlocked" : "terminal.launchFailed"), {
    durationMs: 15000,
    actions: [
      {
        label: t("terminal.launchCopyInstall"),
        onClick: () => {
          navigator.clipboard.writeText(lines.join("\n")).then(
            () => toast.info(t("common.copied")),
            () => toast.warning(t("op.copyFailed")),
          );
        },
      },
    ],
  });
}
