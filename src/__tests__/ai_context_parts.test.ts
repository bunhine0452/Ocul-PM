import { describe, expect, it, vi } from "vitest";

// AI 패널 2026-07-20 개편 — assembleAiContext 의 파트별 분해(parts).
// 토큰 추정 브레이크다운이 파트 단위로 동작하므로, 토글 조합에 따라
// parts/attached/system 이 일관되게 조립되는지 고정한다.

vi.mock("@/lib/bindings", () => ({
  commands: {
    searchChunks: () =>
      Promise.resolve({
        status: "ok",
        data: [
          { file_path: "src/a.ts", start_line: 1, end_line: 10, content: "const a = 1;" },
          { file_path: "src/b.ts", start_line: 5, end_line: 9, content: "const b = 2;" },
        ],
      }),
    planList: () =>
      Promise.resolve({
        status: "ok",
        data: [
          { plan_id: "p1", title: "개편 플랜", status: "active", done_count: 1, item_count: 2 },
        ],
      }),
    planGet: () =>
      Promise.resolve({
        status: "ok",
        data: {
          items: [
            { item_id: "i1", title: "첫 항목", status: "done", phase: null },
            { item_id: "i2", title: "둘째 항목", status: "todo", phase: "Phase 1" },
          ],
        },
      }),
    gitStatus: () =>
      Promise.resolve({
        status: "ok",
        data: {
          is_git_repo: true,
          head_branch: "main",
          remotes: [{ host: "github.com", owner: "me", repo: "proj", url: "" }],
        },
      }),
    gitLog: () =>
      Promise.resolve({
        status: "ok",
        data: [
          {
            short_sha: "abc1234",
            timestamp: 1750000000,
            author_name: "kim",
            subject: "feat: x",
          },
        ],
      }),
    oculpmListJournalEntries: () =>
      Promise.resolve({
        status: "ok",
        data: [
          {
            status: "done",
            title: "일지 1",
            type: "feature",
            agent_id: "claude-code",
            files_count: 3,
            created_at: "2026-07-19T10:00:00+09:00",
            workday: "20260719",
            relative_path: "journal/20260719/Feature/e1.md",
          },
        ],
      }),
    oculpmGetJournalEntry: () =>
      Promise.resolve({
        status: "ok",
        data: { title: "일지 1", body_markdown: "본문입니다." },
      }),
    oculpmAgentsGetMasterTemplate: () =>
      Promise.resolve({ status: "ok", data: "# 규칙\n일지를 남겨라." }),
  },
}));

import { assembleAiContext } from "@/features/chat/aiContext";
import { DEFAULTS, type Settings } from "@/lib/settings";

const settings: Settings = { ...DEFAULTS, systemPrompt: "너는 한국어로 답한다." };

describe("assembleAiContext — parts 분해", () => {
  it("전부 켜면 주입 순서대로 parts 가 쌓인다", async () => {
    const res = await assembleAiContext({
      projectId: 1,
      query: "이 프로젝트 요약해줘",
      settings,
      includeRag: true,
      includePlanner: true,
      includeGit: true,
      includeOculpm: true,
    });
    expect(res.parts.map((p) => p.key)).toEqual([
      "system",
      "rag",
      "planner",
      "actions",
      "git",
      "oculpm",
    ]);
    // system 문자열은 parts 텍스트의 결합과 일치한다 (추정↔전송 동일 소스).
    expect(res.system).toBe(res.parts.map((p) => p.text).join("\n\n").trim());
    expect(res.attached).toEqual(["코드 2곳", "플래너", "git", "작업일지"]);
    expect(res.chunks).toHaveLength(2);
    // 각 파트에 실제 내용이 들어있다.
    const byKey = Object.fromEntries(res.parts.map((p) => [p.key, p.text]));
    expect(byKey.rag).toContain("src/a.ts");
    expect(byKey.planner).toContain("plan_id: p1");
    expect(byKey.git).toContain("main");
    expect(byKey.oculpm).toContain("일지 1");
  });

  it("토글을 끄면 해당 파트가 빠진다 (git/rag off)", async () => {
    const res = await assembleAiContext({
      projectId: 1,
      query: "질문",
      settings,
      includeRag: false,
      includePlanner: true,
      includeGit: false,
      includeOculpm: false,
    });
    const keys = res.parts.map((p) => p.key);
    expect(keys).toEqual(["system", "planner", "actions"]);
    expect(res.attached).toEqual(["플래너"]);
  });

  it("질문이 비면 RAG 검색을 건너뛴다 (토큰 추정의 ragPending 케이스)", async () => {
    const res = await assembleAiContext({
      projectId: 1,
      query: "",
      settings,
      includeRag: true,
      includePlanner: false,
      includeGit: false,
      includeOculpm: false,
      includeActions: false,
    });
    expect(res.parts.map((p) => p.key)).toEqual(["system"]);
    expect(res.chunks).toHaveLength(0);
  });
});
