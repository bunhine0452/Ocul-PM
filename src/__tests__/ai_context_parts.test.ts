import { describe, expect, it, vi } from "vitest";

// 실제 AGENTS 마스터의 절 구조를 그대로 흉내낸 픽스처 (§7·§8 이 압도적으로 큼).
const RULES_MASTER = [
  "<!-- oculpm:begin v1 -->",
  "# ocul-pm 작업 기록 규칙 (v1)",
  "",
  "당신은 ocul-pm 으로 추적되는 프로젝트에서 작업하고 있습니다.",
  "",
  "## 1. 언제 기록하는가 (5 trigger)",
  "1. bug fix — 재현되던 결함이 더 이상 재현되지 않음을 확인했을 때.",
  "",
  "## 2. 어디에 쓰는가",
  ".oculpm/journal/{YYYYMMDD}/{TypeFolder}/{HHMM}_{type}_{slug}.md",
  "",
  "## 3. Frontmatter (필수)",
  "```yaml",
  "---",
  "schema_version: 1",
  'created_at: "2026-05-24T22:30:13+09:00"',
  "---",
  "```",
  "가".repeat(700),
  "",
  "## 4. 본문 구조 (타입별 강제 헤더)",
  "bug/error 는 '## 발생 원인'·'## 해결 방법' 뒤에 '## 검증' 필수.",
  "",
  "## 5. 금지 사항",
  "- secrets / API key / .env 내용을 본문·diff 에 절대 포함 금지.",
  "- .oculpm/index/** 에 절대 쓰지 말 것.",
  "",
  "## 6. 예시",
  "최근 entry 를 직접 읽어 참고하세요.",
  "",
  "## 7. Planner 갱신 (작업 일지와 별개)",
  "나".repeat(2700),
  "",
  "## 8. 문제 해결 문서",
  "다".repeat(1800),
  "<!-- oculpm:end -->",
].join("\n");

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

import { assembleAiContext, digestRules } from "@/features/chat/aiContext";
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

  // 규칙 다이제스트 — 예전 `clampText(master, 2500)` 은 §3 YAML 중간을 잘라
  // §4~§8 을 통째로 버렸고, 그래서 §5 의 시크릿 금지가 한 번도 전달되지 않았다.
  describe("digestRules", () => {
    it("예산을 넘으면 §5 금지 사항을 반드시 남긴다", () => {
      const out = digestRules(RULES_MASTER);
      expect(out.length).toBeLessThanOrEqual(RULES_MASTER.length);
      expect(out).toContain("## 5. 금지 사항");
      expect(out).toContain("secrets");
      expect(out).toContain(".oculpm/index/**");
    });

    it("절 경계로 자르므로 YAML 블록이 반쪽으로 남지 않는다", () => {
      const out = digestRules(RULES_MASTER);
      // ``` 펜스는 항상 짝수 개 (열고 닫힘).
      expect((out.match(/```/g) ?? []).length % 2).toBe(0);
    });

    it("§1 트리거와 §4 본문 헤더도 남기고, 생략은 눈에 보이게 알린다", () => {
      const out = digestRules(RULES_MASTER);
      expect(out).toContain("## 1. 언제 기록하는가");
      expect(out).toContain("## 4. 본문 구조");
      expect(out).toMatch(/규칙 \d+개 절 생략/);
    });

    it("예산 안에 들어오면 원문을 그대로 준다", () => {
      const short = "# 규칙\n\n## 1. 트리거\n- 버그 수정";
      expect(digestRules(short)).toBe(short);
    });

    it("## 헤딩이 없는 사용자 편집 마스터는 단순 절단으로 되돌아간다", () => {
      const noHeadings = "가".repeat(4000);
      const out = digestRules(noHeadings, 100);
      expect(out).toContain("… (생략됨)");
      expect(out.length).toBeLessThan(200);
    });
  });

  it("플래너 블록은 잠긴 계획과 종료된 항목을 싣지 않는다", async () => {
    // planList 목은 active 플랜 1개 + 항목 2개(done i1, todo i2) 를 준다.
    const res = await assembleAiContext({
      projectId: 1,
      query: "x",
      settings,
      includeRag: false,
      includePlanner: true,
      includeGit: false,
      includeOculpm: false,
    });
    const planner = res.parts.find((p) => p.key === "planner")?.text ?? "";
    expect(planner).toContain("active only");
    expect(planner).toContain("item_id: i2"); // todo — 살아 있는 항목
    expect(planner).not.toContain("item_id: i1"); // done — 개수로만
    expect(planner).toContain("종료된 항목 1건 생략");
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
