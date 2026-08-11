// 셸이 OSC 0/2 로 알려온 제목 → 터미널 탭 라벨 (2026-07-30).
//
// 탭이 전부 "zsh" / "zsh 2" 로만 남아 어느 탭에서 뭘 돌리는지 알 수 없던 문제.
// iTerm2 처럼 셸/실행 중인 명령이 알려주는 제목을 따라간다. 다만 사용자가
// 더블클릭으로 직접 지은 이름은 절대 덮지 않는다 — 기본 라벨일 때만 갱신한다.
// (덕분에 `TerminalTab` 에 "renamed" 같은 필드를 새로 둘 필요가 없다.)

/**
 * `addTab()` 이 만드는 기본 라벨 — "zsh", "zsh 2" …
 *
 * 셸 실행 파일 이름이라 번역하지 않는다 (기본 라벨은 언제나 ASCII). 예전엔
 * `셸` 도 후보에 있었지만 그런 라벨을 만드는 경로가 없어 죽은 분기였다 —
 * i18n 라운드에서 걷어냈다.
 */
const DEFAULT_LABEL = /^(zsh|bash|sh|fish|dash)(\s+\d+)?$/;

/** `user@host: ~/dir` 형태의 흔한 프롬프트 제목에서 앞부분을 떼어낸다. */
const USER_HOST_PREFIX = /^[^\s:]+@[^\s:]+:\s*/;

const MAX_LABEL_LENGTH = 24;

/** 사용자가 직접 지은 이름이면 false — 자동 제목이 덮어쓰지 않는다. */
export function canAutoRename(currentLabel: string): boolean {
  return DEFAULT_LABEL.test(currentLabel.trim());
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

  // 경로처럼 보이면 마지막 구성요소만 (홈은 ~ 그대로).
  const looksLikePath = /^[~/.]/.test(withoutHost) && !withoutHost.includes(" ");
  const base = looksLikePath ? pathTail(withoutHost) : withoutHost;
  if (!base) return null;

  if (base.length <= maxLength) return base;
  return looksLikePath
    ? `…${base.slice(base.length - (maxLength - 1))}`
    : `${base.slice(0, maxLength - 1)}…`;
}

function pathTail(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  if (!trimmed || trimmed === "~") return trimmed || "/";
  const tail = trimmed.slice(trimmed.lastIndexOf("/") + 1);
  return tail || trimmed;
}
