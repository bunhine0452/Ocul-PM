// 검증 칸의 증거 등급 — 앱 `src-tauri/src/oculpm/evidence.rs` 와 같은 규칙.
//
// 두 쪽이 갈라지지 않게 같은 사례표(`src-tauri/src/git/receipt_cases.json`)를 양쪽 테스트가 읽는다.
// Rust 정규식의 `\b` 는 유니코드 단어 경계라, JS 의 ASCII `\b` 대신 `W`(유니코드 글자·숫자·_) 둘레 검사로 옮겼다
// — 「## 검증 (2)」 에서 JS `\b` 는 경계를 못 찾는다.

export const NONE = 0;
export const SECTION = 1;
export const COMMAND = 2;
export type Evidence = typeof NONE | typeof SECTION | typeof COMMAND;

const W = String.raw`[\p{L}\p{N}_]`;
const HEADER = new RegExp(String.raw`^#{2,4}\s*(검증|Verification)(?!${W})`, "mu");
const NEXT_HEADING = /^#{1,4}\s/mu;
const COMMAND_EVIDENCE = new RegExp(
  String.raw`cargo (test|clippy|build|check|fmt)|pnpm (test|typecheck|lint|build|vitest|tauri build)|vitest|tsc --noEmit|(?<!${W})tsc(?!${W})|pytest|npm (run )?test|exit 0|통과|green|초록`,
  "u",
);
const SELF_UNVERIFIED =
  /실기기[^\n]{0,20}(미확인|확인 (대기|안|못|전)|미검증)|육안[^\n]{0,15}(대기|미확인|못|안 했|이월)|미검증|검증하지 (못|않)|확인하지 (못|않)|확인 못|not (yet )?verified|unverified|사용자 (육안 )?확인 대기|수동 확인 (필요|대기)/u;

/** 검증 칸 본문 — 다음 헤딩 앞까지. 칸이 없으면 null. */
export function verificationSection(body: string): string | null {
  const m = HEADER.exec(body);
  if (!m) return null;
  const rest = body.slice(m.index + m[0].length);
  const next = NEXT_HEADING.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

export function evidenceLevel(body: string): Evidence {
  const section = verificationSection(body);
  if (section === null) return NONE;
  return COMMAND_EVIDENCE.test(section) && !SELF_UNVERIFIED.test(section) ? COMMAND : SECTION;
}

/** 검증 칸의 끝 줄 — 결과가 보통 거기 있다 (`git::race::proof_line`). 120자에서 자른다. */
export function proofLine(section: string): string | null {
  const lines = section.split("\n").map((l) => l.trim().replace(/^[-*]+/, "").trim());
  let found: string | null = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i] !== "" && !lines[i].startsWith("#")) {
      found = lines[i];
      break;
    }
  }
  if (found === null) return null;
  const chars = Array.from(found.replace(/`/g, ""));
  return chars.length > 120 ? chars.slice(0, 120).join("") + "…" : chars.join("");
}
