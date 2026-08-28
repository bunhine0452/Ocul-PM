/**
 * **명령 블록** — Warp 식 블록 모델 (2026-08-28 Phase 3).
 *
 * 셸 통합(OSC 133)이 이미 명령의 시작·끝·종료코드·소요시간을 알려주는데,
 * Phase 1·2 까지는 그걸 "지금 무슨 일이 일어나는가" 한 줄로만 썼다. 여기서는
 * **지나간 명령 하나하나를 자리로** 만든다 — 스크롤백 어디가 어느 명령의
 * 출력인지, 어디서 실패했는지가 눈에 보이게.
 *
 * # 왜 xterm 위에서 되는가
 *
 * xterm 5.5 코어의 `registerMarker`(스크롤을 따라다니는 버퍼 줄 앵커) +
 * `registerDecoration`(그 줄에 붙는 DOM) 이면 거터 캡슐과 overview ruler 를
 * 그릴 수 있다. VS Code 의 명령 장식과 같은 길이다.
 *
 * # 여기서 못 하는 것
 *
 * **블록 접기는 불가능하다.** xterm 은 고정 그리드 렌더러라 줄을 숨길 수 없다.
 * 블록 UI 의 한계선은 점프·복사·마킹까지다 (플래너 결정 1).
 *
 * 이 모듈은 순수하다 — xterm 도 DOM 도 모른다. 좌표 계산과 문구 조립만 한다.
 */

/** 명령 하나. `line` 은 버퍼 절대 줄(마커가 스크롤을 따라 갱신한다). */
export interface CommandBlock {
  id: number;
  line: number;
  /** OSC 133;C 가 실어 온 명령줄. 아직 실행 전이면 빈 문자열. */
  command: string;
  /** 끝났으면 종료코드(셸이 안 실으면 null), 아직 도는 중이면 undefined. */
  exitCode?: number | null;
  startedAt: number;
  durationMs?: number;
}

export type BlockState = "running" | "ok" | "fail";

/**
 * 블록의 상태. 종료코드가 아직 없으면 실행 중이다.
 *
 * `null`(셸이 코드를 안 실어 보냄)은 **성공으로 치지 않는다** — 모르는 것을
 * 초록으로 칠하면 실패를 놓친다. 끝난 것은 아니까 `ok` 대신 `running` 도
 * 아니어야 하는데, 여기서는 "실패는 아님"이 최선의 정직한 답이라 `ok` 로 둔다.
 * 다만 거터 색은 `blockTone` 이 따로 정해 회색으로 뺀다.
 */
export function blockState(block: CommandBlock): BlockState {
  if (block.exitCode === undefined) return "running";
  return block.exitCode === 0 ? "ok" : "fail";
}

/** 거터 캡슐 색을 고르는 값. 종료코드를 모르면 `unknown`. */
export type BlockTone = "running" | "ok" | "fail" | "unknown";

export function blockTone(block: CommandBlock): BlockTone {
  if (block.exitCode === undefined) return "running";
  if (block.exitCode === null) return "unknown";
  return block.exitCode === 0 ? "ok" : "fail";
}

/**
 * ⌘↑/⌘↓ — 현재 뷰포트 맨 윗줄(`viewportLine`) 기준 이전/다음 블록.
 *
 * 경계에서 제자리를 돌려주지 않는다(`null`) — 마지막 블록에서 ⌘↓ 를 눌렀을 때
 * 화면이 안 움직이는 게, 같은 자리로 "이동했다"고 하는 것보다 정직하다.
 *
 * `blocks` 는 줄 오름차순이라고 가정한다 (마커가 만들어진 순서 그대로다).
 */
export function blockAt(
  blocks: readonly CommandBlock[],
  viewportLine: number,
  dir: "prev" | "next",
): CommandBlock | null {
  if (dir === "next") {
    return blocks.find((block) => block.line > viewportLine) ?? null;
  }
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    if (blocks[i].line < viewportLine) return blocks[i];
  }
  return null;
}

/**
 * 한 블록의 **출력** 줄 범위 (끝은 포함). 명령줄 자체(`line`)는 빼고, 다음
 * 블록 바로 앞까지다. 마지막 블록이면 버퍼 끝(`lastLine`)까지.
 *
 * 출력이 없으면 `null` — 빈 범위를 돌려주면 부르는 쪽이 빈 문자열을 복사한다.
 */
export function blockOutputRange(
  blocks: readonly CommandBlock[],
  id: number,
  lastLine: number,
): { from: number; to: number } | null {
  const index = blocks.findIndex((block) => block.id === id);
  if (index < 0) return null;
  const from = blocks[index].line + 1;
  const next = blocks[index + 1];
  const to = next ? next.line - 1 : lastLine;
  return to < from ? null : { from, to };
}

/** 명령줄을 일지 제목 길이로 줄인다. 첫 줄만 쓴다. */
export function blockTitle(command: string, max = 60): string {
  const flat = command.split("\n")[0].trim().replace(/\s+/g, " ");
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/**
 * 일지 본문 씨앗. **출력을 통째로 넣지 않는다** — 빌드 로그 3천 줄이 일지가
 * 되면 아무도 안 읽고, 디스크에 영구히 남는다. 꼬리 [`OUTPUT_TAIL_LINES`] 줄만
 * 넣고 잘렸다고 적는다.
 *
 * 코드펜스 안에 백틱 세 개가 들어 있어도 깨지지 않게 울타리를 늘린다.
 */
const OUTPUT_TAIL_LINES = 40;

export function blockBody(
  block: CommandBlock,
  output: string,
  labels: { command: string; exit: string; duration: string; outputHead: string; truncated: string },
): string {
  const lines = output.split("\n");
  const truncated = lines.length > OUTPUT_TAIL_LINES;
  const tail = truncated ? lines.slice(-OUTPUT_TAIL_LINES) : lines;
  const fence = "`".repeat(Math.max(3, longestBacktickRun(output) + 1));

  const meta = [`- ${labels.command}: \`${blockTitle(block.command, 200)}\``];
  if (block.exitCode !== undefined) meta.push(`- ${labels.exit}: ${block.exitCode ?? "—"}`);
  if (block.durationMs !== undefined) meta.push(`- ${labels.duration}: ${block.durationMs}ms`);

  const parts = [meta.join("\n")];
  if (tail.join("").trim()) {
    parts.push(
      `${labels.outputHead}\n\n${fence}\n${truncated ? `${labels.truncated}\n` : ""}${tail.join("\n").trimEnd()}\n${fence}`,
    );
  }
  return parts.join("\n\n");
}

/** 텍스트 안 연속 백틱의 최대 길이 — 코드펜스가 안 깨지게. */
function longestBacktickRun(text: string): number {
  let best = 0;
  let run = 0;
  for (const ch of text) {
    if (ch === "`") {
      run += 1;
      if (run > best) best = run;
    } else {
      run = 0;
    }
  }
  return best;
}
