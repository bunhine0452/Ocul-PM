// 일지 diff(unified patch)를 **현재 내용에서 거꾸로 적용**해 "그 일지 이전"
// 텍스트를 만든다 — 인라인 비교("에이전트가 바꾼 부분")의 원본이 된다.
//
// 왜 거꾸로인가: 사이드카에는 패치만 있고 이전/이후 전문이 없다. 이후 전문은
// 지금 열려 있는 파일이 곧 그것이므로(그 일지가 마지막 변경이라면), 패치를
// 거꾸로 물리면 이전이 나온다.
//
// **엄격하게 실패한다.** 파일이 그 일지 이후로 더 바뀌었으면 헝크의 문맥이
// 현재 내용과 안 맞는다 — 그때 대충 맞는 자리에 물리면 엉뚱한 줄이 "에이전트가
// 바꾼 것"으로 표시된다. 못 맞추면 null 을 돌려주고, 호출자는 일지 화면의
// diff 모달로 안내한다 (거짓 비교보다 정직한 후퇴가 낫다).

interface Hunk {
  /** 새 파일 기준 시작 줄 (1-based) — 탐색의 첫 후보 위치. */
  newStart: number;
  /** 새 파일에 있는 줄들 (문맥 + 추가). 현재 내용에서 찾을 블록. */
  newLines: string[];
  /** 옛 파일에 있는 줄들 (문맥 + 삭제). 갈아끼울 블록. */
  oldLines: string[];
}

/** `@@ -a,b +c,d @@` 헤더. b/d 는 생략될 수 있다 (`@@ -1 +1 @@`). */
const HUNK_RE = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** 패치 본문 → 헝크 목록. 읽을 수 없는 모양이면 null (조용한 오적용 방지). */
export function parseHunks(patch: string): Hunk[] | null {
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  for (const line of patch.split("\n")) {
    const header = HUNK_RE.exec(line);
    if (header) {
      current = { newStart: Number(header[1]), newLines: [], oldLines: [] };
      hunks.push(current);
      continue;
    }
    if (!current) continue; // diff --git · index · ---/+++ 머리말
    if (line.startsWith("\\")) continue; // "\ No newline at end of file"
    if (line.startsWith("+")) current.newLines.push(line.slice(1));
    else if (line.startsWith("-")) current.oldLines.push(line.slice(1));
    else if (line.startsWith(" ")) {
      current.newLines.push(line.slice(1));
      current.oldLines.push(line.slice(1));
    } else if (line === "") {
      // 패치 끝의 빈 줄 — 헝크 안의 빈 문맥 줄은 " " 로 오므로 이건 경계다.
      current = null;
    } else {
      return null; // 모르는 줄 — 어긋난 채 계속 읽는 것보다 실패가 낫다.
    }
  }
  return hunks;
}

/** `lines[at..]` 이 `block` 과 정확히 일치하는가. */
function matchesAt(lines: string[], at: number, block: string[]): boolean {
  if (at < 0 || at + block.length > lines.length) return false;
  for (let i = 0; i < block.length; i++) {
    if (lines[at + i] !== block[i]) return false;
  }
  return true;
}

/** 기대 위치 주변에서 블록을 찾는다 — 앞선 일지가 줄을 밀었을 수 있다. */
const SEARCH_RADIUS = 200;

/**
 * 현재 내용에서 패치를 거꾸로 물린 "이전" 텍스트. 못 맞추면 null.
 *
 * 헝크는 **아래에서 위로** 적용한다 — 위에서부터 갈아끼우면 아래 헝크의 줄
 * 번호가 전부 어긋난다.
 */
export function reverseApplyPatch(current: string, patch: string): string | null {
  const hunks = parseHunks(patch);
  if (!hunks || hunks.length === 0) return null;

  const lines = current.split("\n");
  // 각 헝크의 실제 위치를 먼저 전부 확정한다 — 하나라도 못 찾으면 아무것도
  // 바꾸지 않는다 (전부 아니면 전무, 이름 바꾸기 적용과 같은 태도).
  const placed: Array<{ at: number; hunk: Hunk }> = [];
  for (const hunk of hunks) {
    const expect = hunk.newStart - 1;
    let at = -1;
    if (matchesAt(lines, expect, hunk.newLines)) {
      at = expect;
    } else {
      for (let d = 1; d <= SEARCH_RADIUS && at < 0; d++) {
        if (matchesAt(lines, expect - d, hunk.newLines)) at = expect - d;
        else if (matchesAt(lines, expect + d, hunk.newLines)) at = expect + d;
      }
    }
    if (at < 0) return null;
    placed.push({ at, hunk });
  }
  // 겹치는 헝크는 없어야 정상이지만, 탐색이 밀리면 생길 수 있다 — 거부.
  placed.sort((a, b) => a.at - b.at);
  for (let i = 1; i < placed.length; i++) {
    if (placed[i - 1].at + placed[i - 1].hunk.newLines.length > placed[i].at) return null;
  }

  for (let i = placed.length - 1; i >= 0; i--) {
    const { at, hunk } = placed[i];
    lines.splice(at, hunk.newLines.length, ...hunk.oldLines);
  }
  return lines.join("\n");
}
