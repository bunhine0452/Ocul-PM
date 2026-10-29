// 일지 본문의 「## 검증」 칸을 읽는다 — 증거 등급(`oculpm/evidence.rs`)의 근거가 된 줄들이다.
// 등급 자체는 캐시 투영이 매긴다. 여기는 그 근거를 **보여 주려고** 줄을 꺼낼 뿐이다.

// 끝 경계는 `\b` 가 아니다 — `\b` 는 한글을 낱말 문자로 안 봐서 「## 검증」 뒤에서 영영 맞지 않았다
// (예전 EvidenceCard 가 한국어 일지의 검증 줄을 한 번도 못 읽던 이유). 글자·숫자가 이어지지만 않으면 된다.
// i18n-ignore-next-line -- 일지 본문의 섹션 헤더를 찾는 정규식 (표시 문자열 아님)
const HEADER = /^#{2,4}\s*(검증|Verification)(?![\p{L}\p{N}_])/mu;
const NEXT = /^#{1,4}\s/m;

/** 표시용으로 인라인 마크다운 표식(`` ` ``·`**`)을 벗긴다 — 명령은 mono 상자 안이라 이미 코드다. */
function plain(line: string): string {
  return line.replace(/`/g, "").replace(/\*\*/g, "");
}

/** 검증 칸의 줄들 — 목록 표식·코드 울타리·빈 줄 제외, 최대 `cap` 줄. 칸이 없으면 `[]`. */
export function verificationLines(body: string, cap = 8): string[] {
  const m = HEADER.exec(body);
  if (!m) return [];
  const rest = body.slice(m.index + m[0].length);
  const end = NEXT.exec(rest);
  const section = end ? rest.slice(0, end.index) : rest;
  return section
    .split("\n")
    .map((l) => l.replace(/^\s*[-*]\s+/, "").trim())
    .filter((l) => l.length > 0 && !l.startsWith("```"))
    .map(plain)
    .slice(0, cap);
}

/** 본문 첫 줄이 제목(`[x] 제목` · `# 제목`)이면 걷는다 — 상세가 제목을 이미 큰 활자로 보였다. */
export function withoutTitle(body: string, title: string): string {
  const lines = body.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i >= lines.length) return body;
  const first = lines[i]
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[-*]\s*/, "")
    .replace(/^\[[ xX]\]\s*/, "")
    .trim();
  if (first !== title.trim()) return body;
  const rest = lines.slice(i + 1);
  while (rest.length && rest[0].trim() === "") rest.shift();
  return rest.join("\n");
}

/**
 * 검증 칸을 뺀 본문 — 상세는 검증 줄을 따로 상자에 보이므로 본문에서 다시 읽히지 않게 한다
 * (화면 검사 {#journal-body}: 「전체 본문」을 펼치면 요약과 검증이 한 번 더 나왔다).
 */
export function withoutVerification(body: string): string {
  const m = HEADER.exec(body);
  if (!m) return body;
  const head = body.slice(0, m.index);
  const rest = body.slice(m.index + m[0].length);
  const end = NEXT.exec(rest);
  const tail = end ? rest.slice(end.index) : "";
  return `${head.trimEnd()}\n\n${tail}`.trim();
}
