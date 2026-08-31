// AD-4 — 사건 화면이 규칙·스킬 만들기로 넘길 때 쓰는 순수 씨앗 계산
// (docs/agent-discipline/00-master-plan.md D3).
//
// "이걸 규칙으로" 를 눌렀을 때 빈 폼이 뜨면 아무도 안 채운다. 사건 화면이 이미
// 아는 것(일지 제목·바뀐 파일·방금 친 명령)에서 슬러그와 `paths` 를 뽑아
// 미리 채운다. 여기에는 DOM·백엔드·사전이 없다 — 문자열 산술뿐이라 테스트가
// 계약을 그대로 고정한다.

/** 파일명으로 쓸 수 있는 길이 상한 (백엔드 kebab 검증은 64자). */
const SLUG_MAX = 48;

/** 임의 문자열 → kebab 슬러그. 라틴 문자가 없으면 빈 문자열이 된다. */
export function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, "");
}

/**
 * 후보들을 순서대로 시험해 **첫 유효 슬러그**를 고른다. 한국어 제목처럼 라틴
 * 문자가 없으면 전부 비므로 빈 문자열을 돌려준다 — 그때는 사용자가 이름을
 * 직접 적는다 (엉뚱한 자동 이름을 만드는 것보다 낫다).
 */
export function firstSlug(...candidates: (string | null | undefined)[]): string {
  for (const candidate of candidates) {
    if (!candidate) continue;
    const slug = toSlug(candidate);
    if (/^[a-z0-9]/.test(slug)) return slug;
  }
  return "";
}

/**
 * 바뀐 파일 목록 → 규칙 `paths` 후보. 파일이 많이 모인 디렉터리 순으로
 * `<dir>/**` 를 최대 `max` 개. 루트 파일(디렉터리 없음)은 건너뛴다 —
 * `**` 만 남으면 "항상 로드" 와 다를 바 없고, 그건 사용자가 고를 일이다.
 */
export function ruleGlobsFromPaths(paths: readonly string[], max = 3): string[] {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const idx = path.lastIndexOf("/");
    if (idx <= 0) continue;
    const dir = path.slice(0, idx);
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([dir]) => `${dir}/**`);
}

/**
 * 터미널 명령들 → 스킬 본문에 넣을 코드 블록. 빈 줄·중복 연속 명령은 접는다.
 * 본문의 산문은 호출부가 사전에서 붙인다 (이 모듈은 언어를 모른다).
 */
export function commandsToCodeBlock(commands: readonly string[]): string {
  const lines: string[] = [];
  for (const raw of commands) {
    const command = raw.trim();
    if (!command || command === lines[lines.length - 1]) continue;
    lines.push(command);
  }
  return lines.length === 0 ? "" : ["```bash", ...lines, "```"].join("\n");
}
