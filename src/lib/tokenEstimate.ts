// AI 패널 — 전송 전 입력 토큰 추정 (휴리스틱).
//
// 실제 토크나이저(BPE) 없이 문자 계열별 평균 밀도로 근사한다. 목적은 과금
// 정확도가 아니라 "이 질문이 대략 얼마짜리 입력인가"를 전송 전에 보여주는 것.
// 관측 기준(cl100k/o200k/Claude 계열 평균):
//   ASCII(영문·코드)  ≈ 3.6 chars/token
//   한글·CJK          ≈ 1.4 chars/token (≈ 0.7 token/char)
//   기타 유니코드      ≈ 2 chars/token
// ±30% 오차를 전제로 UI 에는 항상 "~" 를 붙여 근사임을 밝힌다.

export function estimateTokens(text: string): number {
  if (!text) return 0;
  let ascii = 0;
  let cjk = 0;
  let other = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.codePointAt(i)!;
    if (c > 0xffff) i++; // surrogate pair — 1 문자로 계산
    if (c < 128) ascii++;
    else if (
      (c >= 0xac00 && c <= 0xd7a3) || // 한글 음절
      (c >= 0x1100 && c <= 0x11ff) || // 한글 자모
      (c >= 0x3130 && c <= 0x318f) || // 호환 자모
      (c >= 0x4e00 && c <= 0x9fff) || // CJK 한자
      (c >= 0x3040 && c <= 0x30ff) // 가나
    )
      cjk++;
    else other++;
  }
  return Math.ceil(ascii / 3.6 + cjk * 0.7 + other * 0.5);
}

/** 메시지 1건당 role 래핑 등 프로토콜 오버헤드 근사치. */
export const MESSAGE_OVERHEAD_TOKENS = 4;

/** 대화 기록(멀티턴 리플레이) 전체의 추정 토큰. */
export function estimateMessagesTokens(messages: { content: string }[]): number {
  return messages.reduce(
    (sum, m) => sum + MESSAGE_OVERHEAD_TOKENS + estimateTokens(m.content),
    0,
  );
}

/** 1234 → "1.2k", 987 → "987", 45600 → "46k" */
export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return (k < 10 ? k.toFixed(1).replace(/\.0$/, "") : String(Math.round(k))) + "k";
}
