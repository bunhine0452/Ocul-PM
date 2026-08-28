import { describe, expect, test } from "vitest";
import {
  blockAt,
  blockBody,
  blockOutputRange,
  blockState,
  blockTitle,
  blockTone,
  type CommandBlock,
} from "@/features/terminal/commandBlocks";

// 명령 블록(2026-08-28 Phase 3)의 좌표 계산과 문구 조립. 눈으로 확인하기
// 어려운 것들이라 여기서 못 잡으면 조용히 틀린 자리로 스크롤한다.

const block = (id: number, line: number, over: Partial<CommandBlock> = {}): CommandBlock => ({
  id,
  line,
  command: `cmd${id}`,
  startedAt: 0,
  ...over,
});

const LABELS = {
  command: "명령",
  exit: "종료코드",
  duration: "소요",
  outputHead: "출력",
  truncated: "생략",
};

describe("blockState · blockTone", () => {
  test("종료코드가 아직 없으면 실행 중", () => {
    expect(blockState(block(1, 0))).toBe("running");
    expect(blockTone(block(1, 0))).toBe("running");
  });

  test("0 은 성공, 그 밖은 실패", () => {
    expect(blockState(block(1, 0, { exitCode: 0 }))).toBe("ok");
    expect(blockState(block(1, 0, { exitCode: 130 }))).toBe("fail");
  });

  test("셸이 코드를 안 실어 보내면(null) 초록으로 칠하지 않는다", () => {
    // 모르는 것을 성공으로 그리면 실패를 놓친다 — 거터는 회색으로 뺀다.
    expect(blockTone(block(1, 0, { exitCode: null }))).toBe("unknown");
  });
});

describe("blockAt — ⌘↑/⌘↓ 이동", () => {
  const blocks = [block(1, 10), block(2, 40), block(3, 90)];

  test("다음은 뷰포트보다 아래 첫 블록", () => {
    expect(blockAt(blocks, 10, "next")?.id).toBe(2);
    expect(blockAt(blocks, 39, "next")?.id).toBe(2);
    expect(blockAt(blocks, 40, "next")?.id).toBe(3);
  });

  test("이전은 뷰포트보다 위 마지막 블록", () => {
    expect(blockAt(blocks, 90, "prev")?.id).toBe(2);
    expect(blockAt(blocks, 41, "prev")?.id).toBe(2);
    expect(blockAt(blocks, 40, "prev")?.id).toBe(1);
  });

  test("경계에서 제자리를 돌려주지 않는다 — 안 움직이는 게 정직하다", () => {
    expect(blockAt(blocks, 90, "next")).toBeNull();
    expect(blockAt(blocks, 10, "prev")).toBeNull();
    expect(blockAt([], 0, "next")).toBeNull();
  });
});

describe("blockOutputRange", () => {
  const blocks = [block(1, 10), block(2, 40), block(3, 90)];

  test("명령줄 다음부터 다음 블록 직전까지", () => {
    expect(blockOutputRange(blocks, 1, 200)).toEqual({ from: 11, to: 39 });
  });

  test("마지막 블록은 버퍼 끝까지", () => {
    expect(blockOutputRange(blocks, 3, 200)).toEqual({ from: 91, to: 200 });
  });

  test("출력이 없으면 null — 빈 범위를 주면 빈 문자열이 복사된다", () => {
    expect(blockOutputRange([block(1, 10), block(2, 11)], 1, 200)).toBeNull();
  });

  test("모르는 id 는 null", () => {
    expect(blockOutputRange(blocks, 99, 200)).toBeNull();
  });
});

describe("blockTitle", () => {
  test("첫 줄만, 공백을 접어서", () => {
    expect(blockTitle("git   commit\n두번째 줄")).toBe("git commit");
  });

  test("길면 말줄임", () => {
    expect(blockTitle("x".repeat(80), 10)).toBe(`${"x".repeat(9)}…`);
  });
});

describe("blockBody — 일지 씨앗", () => {
  test("메타와 출력 꼬리를 담는다", () => {
    const body = blockBody(
      block(1, 0, { command: "pnpm test", exitCode: 1, durationMs: 4200 }),
      "line a\nline b",
      LABELS,
    );
    expect(body).toContain("`pnpm test`");
    expect(body).toContain("종료코드: 1");
    expect(body).toContain("소요: 4200ms");
    expect(body).toContain("line b");
  });

  test("긴 출력은 꼬리만 남기고 잘렸다고 적는다", () => {
    const output = Array.from({ length: 300 }, (_, i) => `줄 ${i}`).join("\n");
    const body = blockBody(block(1, 0, { exitCode: 0 }), output, LABELS);
    expect(body).toContain("생략");
    expect(body).toContain("줄 299");
    expect(body).not.toContain("줄 5\n");
  });

  test("출력에 백틱 세 개가 있어도 코드펜스가 안 깨진다", () => {
    const body = blockBody(block(1, 0, { exitCode: 0 }), "```\nfoo\n```", LABELS);
    expect(body).toContain("````");
  });

  test("출력이 비면 코드펜스를 아예 안 만든다", () => {
    const body = blockBody(block(1, 0, { exitCode: 0 }), "   \n  ", LABELS);
    expect(body).not.toContain("```");
    expect(body).toContain("종료코드: 0");
  });

  test("아직 도는 중이면 종료코드·소요를 지어내지 않는다", () => {
    const body = blockBody(block(1, 0, { command: "claude" }), "", LABELS);
    expect(body).not.toContain("종료코드");
    expect(body).not.toContain("소요");
  });
});
