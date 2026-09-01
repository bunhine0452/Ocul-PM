import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ─── 규칙 도달 회귀 게이트 (Osaurus 라운드 Phase 5 `#rules-ab-check`) ────────
//
// `digestRules` 를 은퇴시키면서 잃을 뻔한 것을 지키는 테스트다. 예전에는 규칙이
// **잘린 채로** 매 턴 자동 주입됐고(한 번은 §5 시크릿 금지가 통째로 잘렸다),
// 이제는 잘리지 않는 대신 **자동으로는 안 들어간다**. 그래서 물어야 할 것이
// 바뀌었다: "규칙이 프롬프트에 있는가" 가 아니라 **"규칙에 도달할 수 있는가"**.
//
// 설계는 "구/신 경로의 조립 문자열 비교" 라고 적었지만 구 경로는 이 라운드에서
// 삭제됐다. 같은 것을 재는 정직한 형태로 바꿨다 — 픽스처의 각 질문마다
//   always     … 매 턴 상주해야 한다 (안전 조항 · 매니페스트 목록)
//   on-demand  … `context_load rules_master` 로 **전문**이 와야 한다
// 를 단언한다. LLM 도 네트워크도 쓰지 않는다.

const RULES_MASTER = [
  "<!-- oculpm:begin v1 -->",
  "# ocul-pm 작업 기록 규칙 (v1)",
  "",
  "## 1. 언제 기록하는가 (5 trigger)",
  "1. bug fix — 재현되던 결함이 더 이상 재현되지 않음을 확인했을 때.",
  "",
  "## 2. 어디에 쓰는가",
  ".oculpm/journal/{YYYYMMDD}/{TypeFolder}/{HHMM}_{type}_{slug}.md",
  "",
  "## 3. Frontmatter (필수)",
  "```yaml",
  "schema_version: 1",
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

vi.mock("@/lib/bindings", () => ({
  commands: {
    searchChunks: () => Promise.resolve({ status: "ok", data: [] }),
    // Phase 5 — 프로젝트 지시문 (없음).
    projectInstructionsGet: () => Promise.resolve({ status: "ok", data: "" }),
    planList: () => Promise.resolve({ status: "ok", data: [] }),
    oculpmListJournalEntries: () => Promise.resolve({ status: "ok", data: [] }),
    oculpmAgentsGetMasterTemplate: () => Promise.resolve({ status: "ok", data: RULES_MASTER }),
    rulesList: () =>
      Promise.resolve({
        status: "ok",
        data: {
          claude_md: [],
          project_rules: [
            {
              scope: "project",
              kind: "rule",
              rel_path: ".claude/rules/api.md",
              name: "api",
              title: "API 규칙",
              exists: true,
              paths: [],
              bytes: 10,
              mirror: "none",
            },
          ],
          global_rules: [],
          project_rules_dir: "",
          global_rules_dir: "",
          cursor_translate: false,
        },
      }),
    skillsList: () =>
      Promise.resolve({
        status: "ok",
        data: { project: [], global: [], project_skills_dir: "", global_skills_dir: "" },
      }),
  },
}));

import { assembleAiContext } from "@/features/chat/aiContext";
import { runContextRequest } from "@/features/chat/contextLoad";
import { buildManifest, resetManifestFreeze, SAFETY_CLAUSES } from "@/features/chat/manifest";
import { DEFAULTS } from "@/lib/settings";

interface Case {
  id: string;
  question: string;
  requires: string;
  reach: "always" | "on-demand";
}

const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures/rules-compliance/questions.json"), "utf8"),
) as { cases: Case[] };

beforeEach(() => resetManifestFreeze());

describe("규칙 도달 가능성", () => {
  it("픽스처는 12개 질문을 덮는다", () => {
    expect(fixture.cases).toHaveLength(12);
  });

  it("always 케이스는 매 턴 컨텍스트에 상주한다", async () => {
    const res = await assembleAiContext({
      projectId: 1,
      query: "아무 질문",
      settings: DEFAULTS,
      includeRag: false,
      includeGit: false,
    });
    for (const c of fixture.cases.filter((x) => x.reach === "always")) {
      expect(res.system, `${c.id}: ${c.question}`).toContain(c.requires);
    }
  });

  it("on-demand 케이스는 rules_master 전문으로 도달한다 — 절단 마커 없이", async () => {
    const manifest = await buildManifest(1);
    const loaded = await runContextRequest(1, { type: "load", kind: "rules_master", id: "" }, manifest);
    for (const c of fixture.cases.filter((x) => x.reach === "on-demand")) {
      expect(loaded, `${c.id}: ${c.question}`).toContain(c.requires);
    }
    // 예전 `digestRules` 가 남기던 생략 마커가 없어야 한다 — 전문이라는 뜻이다.
    expect(loaded).not.toMatch(/절 생략/);
    expect(loaded).not.toContain("(생략됨)");
    // ``` 펜스는 짝수 (반쪽으로 잘리지 않았다).
    expect((loaded.match(/```/g) ?? []).length % 2).toBe(0);
  });

  it("안전 조항 3줄은 온디맨드로 미루지 않는다", async () => {
    const res = await assembleAiContext({
      projectId: 1,
      query: "x",
      settings: DEFAULTS,
      includeRag: false,
      includeGit: false,
    });
    for (const clause of SAFETY_CLAUSES) expect(res.system).toContain(clause);
  });

  it("매니페스트는 규칙을 목록으로만 싣는다 — 본문은 싣지 않는다", async () => {
    const manifest = await buildManifest(1);
    expect(manifest.text).toContain("api");
    // 마스터 본문의 어느 절도 매니페스트에 없다.
    expect(manifest.text).not.toContain("## 7. Planner 갱신");
    expect(manifest.text).not.toContain("나".repeat(50));
  });
});
