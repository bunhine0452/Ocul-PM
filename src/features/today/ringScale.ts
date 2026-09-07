// Today 링의 **눈금** — 값 하나를 호의 채움 비율로 바꾸는 순수 함수들
// (플랜 `v3-release` `{#today-overcount}`).
//
// 컴포넌트에서 떼어 낸 이유는 이 자리가 **두 번 틀린 자리**이기 때문이다:
// ① 2026-08-25 에 캡을 셈에 안 넣은 평평한 클램프(0.97)가 안쪽 링을 닫아
//    버렸고(`c844555` 에서 반지름별 클램프로 고침), ② `k=400` 은 실제 분포에서
//    **매일 상한에 붙어** 링이 정보를 안 날랐다. 둘 다 렌더가 아니라 산수의
//    결함이라 테스트가 붙을 자리도 여기다.
//
// ## 두 개의 상한
//
// 서로 다른 상한이 겹쳐 있어 헷갈리기 쉽다:
//
//  - `maxFraction(r)` — **그릴 수 있는 상한.** 둥근 캡이 대시 양끝 밖으로
//    삐져나오는 길이는 viewBox 실측값이라, `pathLength=100` 공간으로 옮기면
//    반지름에 반비례한다(r=22 는 캡 하나에 2.5 대시단위, r=44 는 1.3). 그래서
//    링마다 상한이 다르다. 이걸 어기면 꼬리가 머리를 타고 올라 **닫힌 원**이 된다.
//  - `RING_K` — **의미의 눈금.** 포화 곡선 `v/(v+k)` 에서 `k` 는 링이 절반쯤
//    차는 값이다. 이건 그림의 한계가 아니라 "이 프로젝트에서 바쁜 하루란
//    얼마인가" 라는 판단이고, 실측으로만 정할 수 있다.
//
// ## `k` 를 어떻게 정했나 (2026-09-07 실측)
//
// 이 저장소의 `.oculpm/index/diffs/**` 사이드카(= 링이 실제로 세는 그 자료)를
// 워크데이별로 합산했다. 8월 이후 26 워크데이: **중앙값 15,400줄**, 범위
// 65~41,790줄. `k=400` 이면 4,100줄부터 상한이라 26일 중 **22일이 상한에**
// 붙는다 — 그 날들은 서로 구별되지 않는다. `k=4000` 이면 중앙값이 0.79,
// 최댓날만 상한에 닿는다. 2026-08-15 의 버려진 브랜치가 실측 근거로 주장한
// 값과 같다("활발한 날은 5k–20k 라인").
//
// 그래도 상한은 남는다 — 이 저장소보다 더 바쁜 날은 있을 수 있고, `files` 는
// 여기서 여전히 상한에 붙는다(중앙값 110개 vs 상한 ~80개). 그래서 눈금을
// 고치는 것과 **별개로** 상한에 붙었다는 사실 자체를 값으로 내보낸다
// (`RingArc.capped`) — 화면이 그걸 말할 수 있게.

/** 호 굵기 (0–100 viewBox 단위). */
export const ARC_SW = 7;
/** `.tr-arc.on` 은 호버 때 굵어지고 캡도 같이 커진다 — 클램프는 최악값으로 잰다. */
export const ARC_SW_HOVER = 8.5;
/** 캡 둘을 치르고도 눈에 남아야 하는 트랙. "거의 전부"가 "전부"와 달라 보이려면 필요하다. */
export const MIN_GAP_DEG = 10;

export const R_OUTER = 44;
export const R_MID = 33;
export const R_INNER = 22;

/**
 * 링별 절반 값. 바꾸면 화면의 뜻이 바뀌므로 위 실측 문단을 함께 고칠 것.
 *
 * `lines` 는 2026-09-07 에 400 → 4000. `journals`·`files` 는 그대로 두었다 —
 * 이 저장소 하나로 모든 사용자의 하루를 정할 수 없고, 상한에 붙은 날은 이제
 * `capped` 가 말한다.
 */
export const RING_K = {
  journals: 4,
  files: 8,
  lines: 4000,
} as const;

/** 둥근 캡 하나가 대시 끝 너머로 더 칠하는 길이 (pathLength=100 단위). */
export function capUnits(r: number): number {
  return ((ARC_SW_HOVER / 2) / (2 * Math.PI * r)) * 100;
}

/** 반지름 `r` 에서 캡 둘을 치르고도 `MIN_GAP_DEG` 를 남기는 최대 대시 비율. */
export function maxFraction(r: number): number {
  return Math.max(0, (100 - 2 * capUnits(r) - (MIN_GAP_DEG / 360) * 100) / 100);
}

export interface RingArc {
  /** 0~`maxFraction(r)`. 0 이면 호를 아예 그리지 않는다 (0 은 점이 아니라 없음). */
  fraction: number;
  /**
   * 이 호가 **상한에 눌렸는가.** 참이면 값이 더 커져도 호는 그대로다 — 화면이
   * 그 사실을 말하지 않으면 상한 위의 날들은 전부 같은 날로 보인다.
   */
  capped: boolean;
}

/**
 * 포화 곡선 `v/(v+k)` 를 반지름별 상한 안으로. 역사적 최댓값 없이도 "바쁠수록
 * 꽉 찬다"를 읽히게 하는 것이 목적이라 비율이 아니다.
 */
export function ringArc(value: number, k: number, r: number): RingArc {
  if (value <= 0) return { fraction: 0, capped: false };
  const ceiling = maxFraction(r);
  const raw = value / (value + k);
  // 부동소수 비교라 문턱을 둔다 — `min` 이 고른 값과 `ceiling` 은 같은 수다.
  return { fraction: Math.min(ceiling, raw), capped: raw >= ceiling - 1e-9 };
}
