// 스트리밍의 **속도 고르기**.
//
// 지금까지는 도착한 글자를 프레임마다 그대로 화면에 얹었다. 그래서 화면의
// 리듬이 곧 **네트워크의 리듬**이었다 — 모델이 한 덩어리를 뱉으면 한 덩어리가
// 툭 튀어나오고, 잠시 조용하면 화면도 멈춘다. 프레임에 맞췄는데도 끊겨 보이던
// 이유가 이것이다. 배치(batching)는 "언제 그릴까"를 고르는 것이지 "얼마나
// 그릴까"를 고르지 않는다.
//
// 그래서 **도착과 표시를 끊는다.** 도착한 글자는 대기줄에 쌓고, 화면은 매
// 프레임 자기 속도로 대기줄에서 꺼내 쓴다. 대기줄이 길수록 빨리 꺼내 밀리지
// 않게 하되, 한 번에 통째로 붓지는 않는다 — 그 사이 균질한 흐름이 생긴다.

/** 한 프레임에 꺼낼 글자 수를 정하는 값들. */
export interface PacerOptions {
  /**
   * 대기줄을 몇 프레임에 걸쳐 비울지. 작을수록 빠르고 거칠다.
   *
   * 6 이면 60fps 기준 약 100ms 안에 밀린 것을 따라잡는다 — 사람이 "느리다"고
   * 느끼기 전이면서, 한 덩어리로 튀는 것은 여러 프레임에 걸쳐 펴진다.
   */
  divisor?: number;
  /** 대기줄이 남아 있으면 최소 이만큼은 나간다 (한 글자씩 기어가지 않게). */
  min?: number;
}

/**
 * 이번 프레임에 드러낼 글자 수.
 *
 * 밀린 만큼 빨라진다 — 긴 답이 쏟아져도 화면이 뒤처지지 않고, 짧은 조각이
 * 띄엄띄엄 와도 최소 속도로 흐른다.
 */
export function revealCount(pending: number, options: PacerOptions = {}): number {
  if (pending <= 0) return 0;
  const divisor = options.divisor ?? 6;
  const min = options.min ?? 2;
  return Math.min(pending, Math.max(min, Math.ceil(pending / divisor)));
}

/**
 * 글자 경계를 **깨지 않고** 자른다.
 *
 * 이모지·한글 조합 문자는 UTF-16 코드 단위 두 개 이상으로 이뤄진다. 코드 단위
 * 한가운데서 자르면 화면에 반쪽짜리 글자(�)가 한 프레임 스쳤다 사라진다.
 */
export function splitAt(text: string, count: number): [string, string] {
  if (count <= 0) return ["", text];
  if (count >= text.length) return [text, ""];

  let at = count;
  const code = text.charCodeAt(at - 1);
  // 앞 글자가 서로게이트 쌍의 앞짝이면 뒷짝까지 데려간다.
  if (code >= 0xd800 && code <= 0xdbff) at += 1;

  // **낱말 한가운데서 끊지 않는다.**
  //
  // 글자 수로만 자르면 "produc" 이 한 프레임 떴다가 "tion" 이 붙는다. 사람 눈은
  // 낱말 단위로 읽어서, 반쪽 낱말이 스치면 매번 읽기를 다시 시작하게 된다 —
  // 흐르는 것이 아니라 덜컹거리는 느낌의 정체가 이것이다. 조금 앞으로 물러나
  // 공백에서 끊되, 너무 멀면(긴 코드·URL) 포기하고 그냥 자른다.
  const LOOKBACK = 12;
  if (at < text.length && !/\s/.test(text[at])) {
    for (let back = at; back > at - LOOKBACK && back > 0; back -= 1) {
      if (/\s/.test(text[back - 1])) return [text.slice(0, back), text.slice(back)];
    }
  }
  return [text.slice(0, at), text.slice(at)];
}
