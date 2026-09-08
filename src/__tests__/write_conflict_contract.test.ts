import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { WRITE_CONFLICT_PREFIX, isWriteConflict } from "@/features/discussion/conflict";

// ─── 쓰기 충돌 표지의 계약 (2026-09-08) ───────────────────────────────────────
//
// 백엔드는 CAS 가 어긋나면 `write-conflict:` 로 시작하는 오류를 돌려주고, 논의
// 화면은 그 접두사로 **물어볼 것이 있는 실패**를 가려낸다. 두 값이 갈라지면
// 아무도 실패하지 않는다 — 화면이 충돌을 평범한 저장 실패로 읽고, 사용자는
// 초안을 어떻게 살릴지 물어보는 대신 "저장 실패" 토스트만 본다.
//
// 타입이 잇지 못하는 경계(Rust 상수 ↔ TS 상수)라 파일 수준에서 문다 —
// `design_tokens.test.ts` 와 같은 방식이다.

const ROOT = join(__dirname, "..", "..");

describe("write-conflict 표지", () => {
  it("TS 상수가 Rust 의 WRITE_CONFLICT_PREFIX 와 글자 그대로 같다", () => {
    const rs = readFileSync(join(ROOT, "src-tauri/src/oculpm/agent_cli.rs"), "utf8");
    const m = rs.match(/pub const WRITE_CONFLICT_PREFIX: &str = "([^"]+)"/);
    expect(m, "agent_cli.rs 에서 WRITE_CONFLICT_PREFIX 를 못 찾았다").not.toBeNull();
    expect(WRITE_CONFLICT_PREFIX).toBe(m![1]);
  });

  it("논의 저장 실패 중 충돌만 가려낸다", () => {
    expect(isWriteConflict(`${WRITE_CONFLICT_PREFIX} 논의 'x' 이 읽은 뒤에 바뀌었습니다`)).toBe(true);
    // 평범한 실패는 충돌이 아니다 — 여기에 선택지를 띄우면 거짓말이 된다.
    expect(isWriteConflict("discussion 'x' not found")).toBe(false);
    expect(isWriteConflict("이 문제 해결 문서는 닫힘(resolved/archived) 상태입니다.")).toBe(false);
    // 봉투가 아닌 값(전송 계층이 던진 Error 등)에도 안 넘어진다.
    expect(isWriteConflict(undefined)).toBe(false);
    expect(isWriteConflict(new Error(WRITE_CONFLICT_PREFIX))).toBe(false);
  });

  it("백엔드의 논의 CAS 오류가 실제로 그 접두사를 달고 나간다", () => {
    const rs = readFileSync(join(ROOT, "src-tauri/src/commands/discussion.rs"), "utf8");
    // 충돌 메시지와 문지기 실패 **둘 다** 표지를 달아야 한다. 하나만 달면
    // 나머지 하나는 화면에서 평범한 실패로 떨어진다.
    expect(rs).toMatch(/fn conflict_message[\s\S]*?WRITE_CONFLICT_PREFIX/);
    expect(rs).toMatch(/fn doc_guard[\s\S]*?WRITE_CONFLICT_PREFIX/);
  });
});
