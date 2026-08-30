/**
 * 백엔드 에러 문자열 → 표시 문자열 (docs/20260811_three-features/03-i18n.md §4.4).
 *
 * ## 왜 이런 모양인가
 *
 * Rust 는 `Result<_, String>` 계약을 유지한 채 **영어만** 반환한다. 130곳을
 * 에러 코드로 바꾸면 계약이 전부 흔들리는데, 얻는 것에 비해 비용이 크다.
 * 대신 프런트가 알려진 문구를 사전으로 되돌린다:
 *
 *   영어 사용자 → 항상 읽을 수 있다 (매핑이 없어도 원문이 영어니까)
 *   한국어 사용자 → 자주 보는 에러부터 점진적으로 이 표에 추가한다
 *
 * **매칭 실패는 실패가 아니다.** 원문(영어)을 그대로 돌려주므로 표가 비어
 * 있어도 앱은 정상 동작한다. 그래서 여기 없는 에러가 있어도 깨지지 않는다.
 *
 * ## 표에 넣는 기준
 *
 * 사용자가 **실제로 자주 보는** 것부터. 내부 오류(`internal: …`)나 IO 실패
 * 원문(`Could not read …: {io error}`)은 번역해도 뒤에 붙는 OS 메시지가 영어라
 * 반쪽이 되므로 우선순위가 낮다.
 */
import { getLang, t, type I18nKey } from "./index";
import type { AppError } from "@/lib/bindings";

function isAppError(e: unknown): e is AppError {
  return typeof e === "object" && e !== null && typeof (e as AppError).code === "string";
}

/**
 * `[정규식, 키]` — 정규식의 캡처 그룹이 사전의 자리표시자로 들어간다.
 * 그룹 이름을 쓰는 이유는 순서 의존을 없애기 위해서다 (`{provider}` 가 어느
 * 언어에서 앞에 오든 뒤에 오든 상관없게).
 */
const RULES: ReadonlyArray<readonly [RegExp, I18nKey]> = [
  [/^No API key configured for (?<provider>.+)$/, "err.noApiKey"],
  [/^File is too large to preview \(over 16MB\)$/, "err.previewTooLarge"],
  [/^Enter a title\.$/, "err.enterTitle"],
  [/^Enter a phase name\.$/, "err.enterPhaseName"],
  [/^Enter a token$/, "err.enterToken"],
  [/^No work was recorded in this period\.$/, "err.noWorkInPeriod"],
  [/^No journal entries to export in this period\.$/, "err.nothingToExport"],
  [/^The retro came back empty\.$/, "err.retroEmpty"],
  [/^The result came back empty\.$/, "err.resultEmpty"],
  [/^A skill with that name already exists: (?<name>.+)$/, "err.skillExists"],
  [/^The target scope already has a skill with that name: (?<name>.+)$/, "err.skillExistsInScope"],
  [/^Skill not found: (?<name>.+)$/, "err.skillNotFound"],
  [
    /^Skill name may only use lowercase letters, digits, and hyphens \(kebab-case\)$/,
    "err.skillNameCharset",
  ],
  [/^Skill name must be 1-64 characters$/, "err.skillNameLength"],
  [/^Skill name cannot contain path characters$/, "err.skillNamePath"],
  [
    /^Rule name may only use lowercase letters, digits, and hyphens \(kebab-case\)$/,
    "err.ruleNameCharset",
  ],
  [/^Rule files must be \.md$/, "err.ruleMustBeMd"],
  [/^File already exists: (?<path>.+)$/, "err.fileExists"],
  [/^Access denied: path is outside the (?<area>.+)$/, "err.accessDenied"],
  [/^This discussion was already promoted to the planner\.$/, "err.alreadyPromoted"],
  [/^There are no legacy goals to import\.$/, "err.nothingToImport"],
  [/^No Notion token configured \(Settings → Data\)$/, "err.notionNoToken"],
  [/^No parent page configured for export \(Settings → Data\)$/, "err.notionNoParent"],
  [/^Could not open the browser$/, "err.browserOpenFailed"],
  [/^CLI timed out \(60s\)$/, "err.cliTimeout"],
];

/**
 * 백엔드가 준 에러 문자열을 현재 언어로. 모르는 문구는 **원문 그대로**.
 *
 * 영어 모드에서는 매칭할 이유가 없다 — 원문이 이미 영어다. 표를 건너뛰어
 * 불필요한 정규식 실행을 피한다.
 */
export function tError(raw: string | AppError | null | undefined): string {
  if (!raw) return "";
  // Phase 4 — 구조화된 오류: 코드가 사전에 있으면 언어에 맞는 문장, 없으면
  // 영어 원문(detail), 그것도 없으면 코드 그대로. `unknown` 은 옛 문자열
  // 계약의 다리라 아래 정규식 표를 그대로 탄다.
  if (isAppError(raw)) {
    if (raw.code !== "unknown") {
      // 사전은 동적 청크라 여기서 정적으로 뒤질 수 없다 — `t` 는 모르는 키를
      // 키 그대로 돌려주므로 그것으로 있고 없음을 안다.
      const key = `err.code.${raw.code}` as I18nKey;
      const text = t(key, { detail: raw.detail ?? "" });
      if (text !== key) return text;
      return raw.detail ?? raw.code;
    }
    return tError(raw.detail ?? "");
  }
  if (getLang() === "en") return raw;
  const trimmed = raw.trim();
  for (const [re, key] of RULES) {
    const m = re.exec(trimmed);
    if (m) return t(key, m.groups ?? {});
  }
  return raw;
}
