// PR-ACP7 — 스트리밍 마크다운을 블록으로 쪼갠다 (순수 함수).
//
// 왜 필요한가: 스트리밍 중 매 프레임 **누적 전체**를 파싱하면 대화가 길수록
// 갱신이 무거워져 타자가 끊겨 보인다. 그렇다고 다 받은 뒤에 한 번에 포맷하면
// 평문이 보이다가 나중에 서식이 입혀지는 **점프**가 생긴다(둘 다 겪었다).
//
// 해법은 블록 단위다. 완성된 블록은 문자열이 더 이상 바뀌지 않으므로 memo 로
// 재파싱을 건너뛰고, 매 프레임 다시 파싱되는 것은 **마지막 블록 하나뿐**이다.
// 비용이 대화 길이가 아니라 문단 길이에 묶인다.

/** 펜스 코드블록 여는/닫는 줄. ``` 또는 ~~~ (앞 공백 3칸까지 허용). */
const FENCE = /^\s{0,3}(```|~~~)/;

/**
 * 마크다운을 블록 배열로 나눈다.
 *
 * 경계는 **빈 줄**이되, 펜스 코드블록 안의 빈 줄은 경계가 아니다 — 안 그러면
 * 코드 한복판이 잘려 반쪽짜리 펜스가 따로 파싱되고 화면이 깨진다.
 *
 * 마지막 원소는 아직 자라는 중일 수 있다(스트리밍). 호출부는 그것만 매번 다시
 * 그리고 나머지는 memo 로 재사용한다.
 */
export function splitMarkdownBlocks(text: string): string[] {
  if (!text) return [];

  const lines = text.split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;

  const flush = () => {
    if (current.length) {
      blocks.push(current.join("\n"));
      current = [];
    }
  };

  for (const line of lines) {
    const fenceMatch = FENCE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (fence === null) {
        // 코드블록 시작 — 앞선 산문을 먼저 끊는다.
        flush();
        fence = marker;
        current.push(line);
        continue;
      }
      if (fence === marker) {
        // 닫는 펜스는 블록에 포함한 뒤 끊는다.
        current.push(line);
        fence = null;
        flush();
        continue;
      }
    }

    if (fence === null && line.trim() === "") {
      flush();
      continue;
    }
    current.push(line);
  }

  flush();
  return blocks;
}
