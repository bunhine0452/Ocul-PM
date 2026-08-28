import { beforeEach, describe, expect, it, vi } from "vitest";
import { detectAgent } from "@/features/terminal/agentDetect";
import {
  _resetManualEntryRequest,
  consumeManualEntryRequest,
  onManualEntryRequest,
  requestManualEntry,
} from "@/lib/journalCompose";

describe("detectAgent", () => {
  it("맨 이름으로 실행한 에이전트를 잡는다", () => {
    expect(detectAgent("claude")).toEqual({ id: "claude-code", label: "Claude Code" });
    expect(detectAgent("gemini -p '요약'")).toEqual({ id: "gemini-cli", label: "Gemini CLI" });
    expect(detectAgent("cursor-agent")).toEqual({ id: "cursor", label: "Cursor" });
    expect(detectAgent("aider --model gpt")).toEqual({ id: "aider", label: "Aider" });
  });

  it("훅 브리지와 같은 라벨을 쓴다 (한 세션에 두 라벨이 붙지 않게)", () => {
    // 백엔드 claude_hooks::HOOK_AGENT_LABEL 과 같은 값이어야 한다.
    expect(detectAgent("claude")?.id).toBe("claude-code");
  });

  it("절대경로·홈 경로로 실행해도 잡는다", () => {
    expect(detectAgent("/opt/homebrew/bin/claude --resume")?.id).toBe("claude-code");
    expect(detectAgent("~/.local/bin/aider")?.id).toBe("aider");
  });

  it("선행 환경변수와 래퍼를 걷어낸다", () => {
    expect(detectAgent("ANTHROPIC_API_KEY=sk-x claude")?.id).toBe("claude-code");
    expect(detectAgent("sudo claude")?.id).toBe("claude-code");
    expect(detectAgent("time nohup claude --print")?.id).toBe("claude-code");
    expect(detectAgent("FOO=1 BAR=2 env claude")?.id).toBe("claude-code");
  });

  it("패키지 러너 경유 실행도 잡는다", () => {
    expect(detectAgent("npx @anthropic-ai/claude-code")?.id).toBe("claude-code");
    expect(detectAgent("npx -y @anthropic-ai/claude-code@latest")?.id).toBe("claude-code");
    expect(detectAgent("pnpm dlx @anthropic-ai/claude-code")?.id).toBe("claude-code");
    expect(detectAgent("bunx claude")?.id).toBe("claude-code");
  });

  it("체인·파이프라인에서 처음 나오는 에이전트를 쓴다", () => {
    expect(detectAgent("git pull && claude")?.id).toBe("claude-code");
    expect(detectAgent("cat spec.md | claude -p")?.id).toBe("claude-code");
    expect(detectAgent("npm ci; aider")?.id).toBe("aider");
  });

  // --- 오탐 방어 (유령 세션의 원인) ---

  it("인자 자리의 이름은 실행이 아니다", () => {
    expect(detectAgent("echo claude")).toBeNull();
    expect(detectAgent("git commit -m 'ask claude to fix'")).toBeNull();
    expect(detectAgent("which claude")).toBeNull();
    expect(detectAgent("man gemini")).toBeNull();
    expect(detectAgent("grep -r claude src/")).toBeNull();
  });

  it("이름이 겹치는 다른 도구를 잡지 않는다", () => {
    expect(detectAgent("claudia")).toBeNull();
    expect(detectAgent("my-claude-wrapper")).toBeNull();
    expect(detectAgent("gemini-something-else")).toBeNull();
  });

  it("빈 입력·공백은 null", () => {
    expect(detectAgent("")).toBeNull();
    expect(detectAgent("   ")).toBeNull();
    expect(detectAgent("npx")).toBeNull();
  });
});

describe("journalCompose one-shot", () => {
  beforeEach(() => {
    _resetManualEntryRequest();
  });

  it("리스너가 붙기 전에 온 요청도 마운트 시 회수된다", () => {
    requestManualEntry();
    expect(consumeManualEntryRequest()).toEqual({});
    // 소비형 — 두 번 열리지 않는다.
    expect(consumeManualEntryRequest()).toBeNull();
  });

  it("이미 구독 중이면 즉시 콜백이 돌고 대기분은 남지 않는다", () => {
    const fn = vi.fn();
    const off = onManualEntryRequest(fn);
    requestManualEntry();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(consumeManualEntryRequest()).toBeNull();
    off();
  });

  it("구독 해제 후에는 콜백이 돌지 않는다", () => {
    const fn = vi.fn();
    onManualEntryRequest(fn)();
    requestManualEntry();
    expect(fn).not.toHaveBeenCalled();
  });

  it("요청이 없으면 회수는 false", () => {
    expect(consumeManualEntryRequest()).toBeNull();
  });
});
