import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { ActivityStream } from "@/features/chat/activity/ActivityStream";
import { PRESENTERS } from "@/features/chat/activity/presenters";
import { ACTIVITY_KINDS } from "@/features/chat/activity/activityTypes";
import { rawEventText, RAW_CHAR_CAP } from "@/features/chat/activity/RawRail";
import type { AcpBlock, AcpToolCall } from "@/features/chat/acpTurns";
import { t } from "@/i18n";

afterEach(cleanup);

let seq = 0;
function tool(over: Partial<AcpToolCall> = {}): AcpBlock {
  seq += 1;
  return {
    kind: "tool",
    call: {
      id: `t${seq}`,
      title: "t",
      kind: "read",
      status: "completed",
      locations: [],
      ...over,
    },
  };
}

describe("활동 흐름", () => {
  it("우리 CLI 가 돈 셸 줄은 「일지 기록」으로 읽힌다", () => {
    render(
      <ActivityStream
        blocks={[
          tool({
            name: "Bash",
            kind: "execute",
            status: "completed",
            input: "oculpm journal_write '{\"title\":\"x\"}'",
          }),
        ]}
        live={false}
      />,
    );
    expect(screen.getByText(t("activity.verb.journal_write"))).toBeInTheDocument();
    expect(document.querySelector(".trace-item.ledger")).not.toBeNull();
  });

  it("우리 원장 줄은 스무 줄 사이에서도 안 접힌다", () => {
    const reads = [tool(), tool(), tool(), tool()];
    const ledger = tool({
      name: "Bash",
      kind: "execute",
      input: "oculpm plan_update '{}'",
    });
    render(<ActivityStream blocks={[...reads, ledger, ...reads.map(() => tool())]} live={false} />);
    expect(document.querySelector(".trace-item.ledger")).not.toBeNull();
    // 읽기는 접혔다 — 우리 줄만 남아 눈에 걸린다.
    expect(document.querySelectorAll(".activity-run").length).toBeGreaterThan(0);
  });

  it("어떤 활동에서든 원본 이벤트로 갈 수 있다", () => {
    render(<ActivityStream blocks={[tool({ name: "Read", status: "in_progress" })]} live />);
    // 도는 줄은 기본이 펼침이므로 레일이 바로 보인다.
    expect(screen.getByText(t("activity.raw.title"))).toBeInTheDocument();
  });

  it("산문이 끼면 묶음이 거기서 끊긴다", () => {
    render(
      <ActivityStream
        blocks={[tool(), tool(), { kind: "text", text: "설명" }, tool(), tool()]}
        live={false}
      />,
    );
    expect(document.querySelectorAll(".activity-run")).toHaveLength(0);
  });
});

describe("프레젠터", () => {
  it("15낱말 모두 얼굴과 몸통을 갖는다", () => {
    for (const kind of ACTIVITY_KINDS) {
      const present = PRESENTERS[kind];
      // lucide 아이콘은 forwardRef 객체다 — 있기만 하면 된다.
      expect(present.Icon).toBeTruthy();
      expect(present.Row).toBeTypeOf("function");
      // 사전에 없는 키면 t() 가 키를 그대로 돌려준다 — 그것이 곧 누락이다.
      expect(t(present.labelKey)).not.toBe(present.labelKey);
      expect(t(present.runKey, { n: 3 })).not.toBe(present.runKey);
    }
  });
});

describe("원본 레일", () => {
  it("실을 것이 없으면 그리지 않는다", () => {
    expect(rawEventText(null)).toBe("");
    expect(rawEventText(undefined)).toBe("");
  });

  it("긴 원본은 자른다 — 여기는 로그 뷰어가 아니다", () => {
    expect(rawEventText({ big: "x".repeat(RAW_CHAR_CAP * 2) })).toHaveLength(RAW_CHAR_CAP);
  });

  it("찍을 수 없는 원본에 화면이 깨지지 않는다", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(rawEventText(loop)).toBe("");
  });
});
