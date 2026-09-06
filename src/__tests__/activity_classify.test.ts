import { describe, expect, it } from "vitest";

import {
  classifyTool,
  parseOculpmCliCommand,
  parseOculpmMcpTool,
} from "@/features/chat/activity/classify";

// 플랜 v3-surface {#activity-classify}.
//
// 이 스위트가 지키는 것은 정확도가 아니라 **틀리는 방향**이다. 「일지를
// 썼습니다」는 사용자 저장소에 파일이 생겼다는 주장이라, 확신이 없으면
// 아무 말도 하지 않고 일반 셸로 흘러야 한다.

describe("oculpm CLI 알아보기", () => {
  it("맨 앞의 oculpm + 아는 도구만 인정한다", () => {
    expect(parseOculpmCliCommand("oculpm journal_write '{\"title\":\"x\"}'")).toEqual({
      tool: "journal_write",
      kind: "oculpm-journal",
    });
    expect(parseOculpmCliCommand("oculpm plan_update '{}'")?.kind).toBe("oculpm-plan");
    expect(parseOculpmCliCommand("oculpm claim_paths '{}'")?.kind).toBe("oculpm-a2a");
  });

  it("환경변수 접두는 건너뛴다", () => {
    expect(parseOculpmCliCommand("OCULPM_X=1 FOO=bar oculpm journal_write '{}'")?.tool).toBe(
      "journal_write",
    );
  });

  it("파이프의 앞머리도 인정한다 — 한 줄에 우리 호출이 하나뿐이면 된다", () => {
    expect(
      parseOculpmCliCommand("oculpm plan_status '{\"plan_id\":\"p\"}' | jq -r '.plans[0].hash'")
        ?.tool,
    ).toBe("plan_status");
  });

  it("명령 치환 안의 호출도 인정한다 (문서에 적힌 관용구)", () => {
    expect(parseOculpmCliCommand("h=$(oculpm plan_status '{\"plan_id\":\"p\"}')")?.tool).toBe(
      "plan_status",
    );
  });

  it("cd 뒤에 오는 것도 인정한다", () => {
    expect(parseOculpmCliCommand("cd /tmp/x && oculpm journal_write '{}'")?.tool).toBe(
      "journal_write",
    );
  });

  it("따옴표 안의 && 는 연산자가 아니다", () => {
    expect(parseOculpmCliCommand("oculpm journal_write '{\"t\":\"a && b\"}'")?.tool).toBe(
      "journal_write",
    );
  });

  // ── 여기부터는 전부 null 이어야 한다 ─────────────────────────────────────

  it("한 줄에 우리 호출이 둘이면 판정을 접는다", () => {
    expect(
      parseOculpmCliCommand("oculpm journal_write '{}' && oculpm plan_update '{}'"),
    ).toBeNull();
  });

  it("oculpm 이 인자로 등장한 것은 우리 호출이 아니다", () => {
    expect(parseOculpmCliCommand("echo oculpm journal_write")).toBeNull();
    expect(parseOculpmCliCommand("grep -rn 'oculpm journal_write' src")).toBeNull();
    expect(parseOculpmCliCommand("cat .oculpm/planner/journal_write.md")).toBeNull();
  });

  it("경로가 붙은 oculpm 은 우리가 보장한 그 바이너리가 아니다", () => {
    expect(parseOculpmCliCommand("/usr/local/bin/oculpm journal_write '{}'")).toBeNull();
    expect(parseOculpmCliCommand("./oculpm journal_write '{}'")).toBeNull();
  });

  it("모르는 낱말은 우리 것이 아니다", () => {
    expect(parseOculpmCliCommand("oculpm whoami")).toBeNull();
    expect(parseOculpmCliCommand("oculpm tools")).toBeNull();
    expect(parseOculpmCliCommand("oculpm project_init '{}'")).toBeNull();
    expect(parseOculpmCliCommand("oculpm")).toBeNull();
    expect(parseOculpmCliCommand("")).toBeNull();
  });
});

describe("MCP 도구 이름", () => {
  it("서버 이름이 무엇이든 우리 서버면 알아본다", () => {
    expect(parseOculpmMcpTool("mcp__oculpm__journal_write")?.kind).toBe("oculpm-journal");
    expect(parseOculpmMcpTool("mcp__plugin_oculpm_oculpm__plan_update")?.kind).toBe("oculpm-plan");
  });

  it("남의 서버와 모르는 도구는 삼키지 않는다", () => {
    expect(parseOculpmMcpTool("mcp__notion__search")).toBeNull();
    expect(parseOculpmMcpTool("mcp__oculpm__something_new")).toBeNull();
    expect(parseOculpmMcpTool("Bash")).toBeNull();
  });
});

describe("체인 — 틀리면 shell 로 흘린다", () => {
  it("우리 CLI 가 돌면 우리 어휘로", () => {
    expect(
      classifyTool({ name: "Bash", kind: "execute", input: "oculpm journal_write '{}'" }),
    ).toEqual({ kind: "oculpm-journal", verb: "journal_write" });
  });

  it("헷갈리는 명령줄은 shell 이다 — 「일지를 썼다」는 원장에 대한 거짓말이 된다", () => {
    for (const input of [
      "echo oculpm journal_write",
      "/usr/local/bin/oculpm journal_write '{}'",
      "oculpm journal_write '{}' && oculpm plan_update '{}'",
    ]) {
      expect(classifyTool({ name: "Bash", kind: "execute", input }).kind).toBe("shell");
    }
  });

  it("셸이 아닌 도구의 입력에서는 명령줄을 읽지 않는다", () => {
    // 읽기 도구의 입력은 경로다 — 그 안에 우리 도구 이름이 있어도 실행이 아니다.
    expect(
      classifyTool({ name: "Read", kind: "read", input: "docs/oculpm journal_write.md" }).kind,
    ).toBe("read");
  });

  it("도구 종류를 우리 어휘로 옮긴다", () => {
    expect(classifyTool({ kind: "edit" }).kind).toBe("edit");
    expect(classifyTool({ kind: "execute" }).kind).toBe("shell");
    expect(classifyTool({ kind: "fetch" }).kind).toBe("web");
    expect(classifyTool({ kind: "think" }).kind).toBe("think");
  });

  it("모르는 종류는 삼키지 않고 other 로 흘린다", () => {
    expect(classifyTool({ kind: "switch_mode" }).kind).toBe("other");
    expect(classifyTool({}).kind).toBe("other");
  });
});
