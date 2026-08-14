import { describe, expect, it } from "vitest";
import {
  claudeCommand,
  newPtySessionId,
  shellQuote,
  stageBootCommand,
  takeBootCommand,
} from "@/features/terminal/terminalLaunch";

// 터미널로 CLI 에이전트를 띄우는 길 (ACP 가 못 닿는 기능의 탈출구).

describe("newPtySessionId", () => {
  /** 접두사는 규격이다 — 창을 닫을 때 백엔드가 이걸로 자기 세션만 골라 죽인다. */
  it("stamps the project so the backend can claim its own sessions", () => {
    expect(newPtySessionId(7)).toMatch(/^p7-[a-z0-9]+$/);
  });

  it("omits the prefix when there is no project", () => {
    expect(newPtySessionId(null)).toMatch(/^[a-z0-9]+$/);
  });
});

describe("boot command registry", () => {
  /** 탭에 얹어 영속화하면 그 탭을 다시 열 때마다 claude 가 또 뜬다 — 사용자는
      셸을 이어 쓰려고 돌아온 것이다. */
  it("hands the command over exactly once", () => {
    stageBootCommand("p1-abc", "claude");
    expect(takeBootCommand("p1-abc")).toBe("claude");
    expect(takeBootCommand("p1-abc")).toBeNull();
  });

  it("returns null for a session nobody staged", () => {
    expect(takeBootCommand("p1-nothing")).toBeNull();
  });
});

describe("shellQuote", () => {
  it("wraps plain text", () => {
    expect(shellQuote("hello world")).toBe("'hello world'");
  });

  /** 감싸지 않으면 백틱·$·; 하나에 엉뚱한 명령이 실행된다. */
  it("neutralises shell metacharacters", () => {
    expect(shellQuote("a; rm -rf /")).toBe("'a; rm -rf /'");
    expect(shellQuote("$(whoami)")).toBe("'$(whoami)'");
    expect(shellQuote("`id`")).toBe("'`id`'");
  });

  /** 홑따옴표 안에서 탈출할 수 있는 것은 홑따옴표 자신뿐이다. */
  it("escapes an embedded single quote", () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
  });
});

describe("claudeCommand", () => {
  it("is a bare launch without a prefill", () => {
    expect(claudeCommand()).toBe("claude");
    expect(claudeCommand("   ")).toBe("claude");
    expect(claudeCommand(null)).toBe("claude");
  });

  /** --prefill 은 입력만 채우고 보내지 않는다 — 사람이 읽고 고칠 틈이 요점이다. */
  it("seeds the composer without submitting", () => {
    expect(claudeCommand("fix the build")).toBe("claude --prefill 'fix the build'");
  });

  it("quotes a prefill that contains shell syntax", () => {
    expect(claudeCommand("rm -rf $HOME")).toBe("claude --prefill 'rm -rf $HOME'");
  });
});
