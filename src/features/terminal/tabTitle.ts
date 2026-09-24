// 셸이 OSC 0/2 로 알려온 제목 → 터미널 탭 라벨 (2026-07-30).
//
// 탭이 전부 "zsh" / "zsh 2" 로만 남아 어느 탭에서 뭘 돌리는지 알 수 없던 문제.
// iTerm2 처럼 셸/실행 중인 명령이 알려주는 제목을 따라간다. 다만 사용자가
// 더블클릭으로 직접 지은 이름은 절대 덮지 않는다 — 기본 라벨일 때만 갱신한다.
// (덕분에 `TerminalTab` 에 "renamed" 같은 필드를 새로 둘 필요가 없다.)
import { getPlatform, isMac } from "@/lib/platform";
import { pathBaseName } from "@/lib/osPath";

/**
 * `addTab()` 이 만드는 기본 라벨 — "zsh", "zsh 2" …
 *
 * 셸 실행 파일 이름이라 번역하지 않는다 (기본 라벨은 언제나 ASCII). 예전엔
 * `셸` 도 후보에 있었지만 그런 라벨을 만드는 경로가 없어 죽은 분기였다 —
 * i18n 라운드에서 걷어냈다.
 */
const DEFAULT_LABEL = /^(zsh|bash|sh|fish|dash)(\s+\d+)?$/;

/**
 * Windows·Linux 의 기본 라벨 — 실제 셸 이름으로 짓는다 (`shellName.ts`, {#ui-e2e-minor}).
 * macOS 는 위의 표 그대로다 (D3): 거기서 "cmd" 라고 손수 지은 탭 이름은 여전히 보존된다.
 */
const DEFAULT_LABEL_PC = /^(zsh|bash|sh|fish|dash|ksh|pwsh|powershell|cmd|nu|shell)(\s+\d+)?$/;

/** `user@host: ~/dir` 형태의 흔한 프롬프트 제목에서 앞부분을 떼어낸다. */
const USER_HOST_PREFIX = /^[^\s:]+@[^\s:]+:\s*/;

const MAX_LABEL_LENGTH = 24;

/** 사용자가 직접 지은 이름이면 false — 자동 제목이 덮어쓰지 않는다. */
export function canAutoRename(currentLabel: string): boolean {
  return (isMac() ? DEFAULT_LABEL : DEFAULT_LABEL_PC).test(currentLabel.trim());
}

/**
 * 셸 제목을 탭 라벨로 정규화한다. 라벨로 쓸 게 없으면 null.
 *
 * - `kim@mac: ~/src/ai-pm` → `ai-pm`
 * - `~/src/ai-pm`          → `ai-pm`
 * - `npm run dev`          → `npm run dev`
 * - 긴 제목은 잘라 `…` 를 붙인다 (경로는 끝이, 명령은 앞이 정보량이 크다).
 */
export function shellTitleToTabLabel(
  title: string,
  maxLength: number = MAX_LABEL_LENGTH,
): string | null {
  const collapsed = title.replace(/\s+/g, " ").trim();
  if (!collapsed) return null;

  const withoutHost = collapsed.replace(USER_HOST_PREFIX, "").trim();
  if (!withoutHost) return null;

  // Windows 콘솔은 제목에 **실행 파일 경로**를 적는다(`C:\Program Files\PowerShell\7\pwsh.exe`,
  // cmd 는 명령을 도는 동안 `…\cmd.exe - <명령>`). 공백이 든 경로라 아래 경로 판정에
  // 안 걸리고 앞머리만 남던 것(E2E) — 실행 파일 이름으로 줄인다.
  if (getPlatform() === "windows") {
    const win = windowsTitle(withoutHost);
    if (win) return win.length <= maxLength ? win : `${win.slice(0, maxLength - 1)}…`;
  }

  // 경로처럼 보이면 마지막 구성요소만 (홈은 ~ 그대로).
  const looksLikePath = /^[~/.]/.test(withoutHost) && !withoutHost.includes(" ");
  const base = looksLikePath ? pathTail(withoutHost) : withoutHost;
  if (!base) return null;

  if (base.length <= maxLength) return base;
  return looksLikePath
    ? `…${base.slice(base.length - (maxLength - 1))}`
    : `${base.slice(0, maxLength - 1)}…`;
}

/** `C:\…\pwsh.exe` → `pwsh`, `C:\…\cmd.exe - npm test` → `cmd - npm test`, `D:\a\proj` → `proj`. */
function windowsTitle(title: string): string | null {
  if (!/^(?:[A-Za-z]:[\\/]|\\\\)/.test(title)) return null;
  const exe = /^(.*?\.exe)(?=$|\s)(.*)$/i.exec(title);
  if (exe) {
    const name = pathBaseName(exe[1], "windows").replace(/\.exe$/i, "");
    const rest = exe[2].trim();
    return rest ? `${name} ${rest}` : name;
  }
  return pathBaseName(title, "windows") || null;
}

function pathTail(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  if (!trimmed || trimmed === "~") return trimmed || "/";
  const tail = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return tail || trimmed;
}
