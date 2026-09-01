import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── 컨텍스트 경제학 (Osaurus 라운드 Phase 5) ───────────────────────────────
//
// 이 파일이 지키는 계약:
//  1. 회상 게이트는 **결정적**이다 — 같은 문장은 언제나 같은 신호.
//  2. 무신호 턴에는 아무것도 안 꺼낸다 (예전엔 매 턴 전부 실렸다).
//  3. 예산을 넘는 후보는 **자르지 않고 버린다** (§5 를 잘라 먹은 전례).
//  4. 매니페스트는 대화 동안 **바이트 동일**이다 — 프롬프트 캐시의 근거.
//  5. 모델의 본문 요청은 텍스트 규약으로 오가고, 사용자에게는 보이지 않는다.

const rulesData = vi.hoisted(() => ({ current: "규칙 v1" }));

vi.mock("@/lib/bindings", () => ({
  commands: {
    // Phase 5 — 프로젝트 지시문 (없음).
    projectInstructionsGet: () => Promise.resolve({ status: "ok", data: "" }),
    planList: () => Promise.resolve({ status: "ok", data: [] }),
    oculpmListJournalEntries: () => Promise.resolve({ status: "ok", data: [] }),
    oculpmAgentsGetMasterTemplate: () => Promise.resolve({ status: "ok", data: rulesData.current }),
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
              name: rulesData.current,
              title: "",
              exists: true,
              paths: [],
              bytes: 1,
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
        data: {
          project: [
            {
              scope: "project",
              dir_name: "run-evals",
              name: "run-evals",
              description: "평가 실행",
              keywords: ["평가", "채점"],
              enabled: true,
              display_path: "",
              extra_files: 0,
            },
          ],
          global: [],
          project_skills_dir: "",
          global_skills_dir: "",
        },
      }),
  },
}));

import {
  approxTokens,
  detectRecall,
  RECALL_BUDGET_TOKENS,
  selectWithinBudget,
  type RecallCandidate,
} from "@/features/chat/recallGate";
import { buildManifest, frozenManifest, resetManifestFreeze, thawManifest } from "@/features/chat/manifest";
import { discover, parseContextRequest, stripContextRequest } from "@/features/chat/contextLoad";

beforeEach(() => {
  rulesData.current = "규칙 v1";
  resetManifestFreeze();
});

describe("회상 게이트 — 신호 표", () => {
  const table: Array<[string, string]> = [
    // verbatim — 원문을 요구하는 말이 가장 강하다
    ["내가 뭐라고 했지?", "verbatim"],
    ["what did i say exactly", "verbatim"],
    // episode — 시간 표현
    ["지난주에 뭐 했지", "episode"],
    ["what did we do last week", "episode"],
    ["어제 작업한 거 보여줘", "episode"],
    // plan
    ["계획 어디까지 했지", "plan"],
    ["what's left on the roadmap", "plan"],
    // fact
    ["전에 정한 컨벤션이 뭐였지", "fact"],
    ["we decided on tabs, right?", "fact"],
    // 무신호 — 일반 질문
    ["이 함수 이름 뭐가 좋을까", "none"],
    ["write a regex for emails", "none"],
    ["", "none"],
  ];

  for (const [turn, expected] of table) {
    it(`"${turn}" → ${expected}`, () => {
      expect(detectRecall(turn)).toBe(expected);
    });
  }

  it("우선순위 — 시간 표현과 원문 요구가 겹치면 원문이 이긴다", () => {
    expect(detectRecall("지난주에 내가 뭐라고 했지")).toBe("verbatim");
  });

  it("영어 신호는 단어 경계로 본다 — explanation 이 plan 을 때리지 않는다", () => {
    expect(detectRecall("give me an explanation of this code")).toBe("none");
  });

  it("같은 문장은 언제나 같은 답이다 (결정적)", () => {
    const once = detectRecall("지난주에 뭐 했지");
    for (let i = 0; i < 5; i += 1) expect(detectRecall("지난주에 뭐 했지")).toBe(once);
  });
});

describe("회상 예산", () => {
  const candidate = (chars: number, score: number, ref: string): RecallCandidate => ({
    text: "가".repeat(chars),
    score,
    kind: "journal",
    ref,
  });

  it("한글은 영어보다 토큰을 많이 먹는 것으로 잡는다 (과소평가 금지)", () => {
    expect(approxTokens("가".repeat(150))).toBeGreaterThan(approxTokens("a".repeat(150)));
  });

  it("상한을 넘지 않고, 관련도 높은 것부터 담는다", () => {
    const picked = selectWithinBudget([
      candidate(600, 0.2, "low"),
      candidate(600, 0.9, "high"),
      candidate(600, 0.5, "mid"),
    ]);
    expect(picked.tokens).toBeLessThanOrEqual(RECALL_BUDGET_TOKENS);
    expect(picked.chosen[0].ref).toBe("high");
    // 넘친 후보는 잘리지 않고 통째로 빠진다 — 반쪽 기록을 넣지 않는다.
    expect(picked.dropped).toBeGreaterThan(0);
    for (const chosen of picked.chosen) expect(chosen.text).toHaveLength(600);
  });

  it("예산 안이면 전부 담고 아무것도 안 버린다", () => {
    const picked = selectWithinBudget([candidate(30, 0.1, "a"), candidate(30, 0.2, "b")]);
    expect(picked.chosen).toHaveLength(2);
    expect(picked.dropped).toBe(0);
  });

  it("후보가 없으면 0 토큰이다", () => {
    expect(selectWithinBudget([])).toEqual({ chosen: [], tokens: 0, dropped: 0 });
  });
});

describe("매니페스트 동결", () => {
  it("대화 중 규칙이 바뀌어도 같은 대화는 같은 바이트를 본다", async () => {
    const first = await frozenManifest(1, 42);
    expect(first.text).toContain("규칙 v1");

    // 디스크가 바뀌었다 (워처가 알려 주는 상황).
    rulesData.current = "규칙 v2";

    const again = await frozenManifest(1, 42);
    expect(again.text).toBe(first.text);
    expect(again.text).not.toContain("규칙 v2");
  });

  it("다른 대화는 새 목록을 받는다", async () => {
    await frozenManifest(1, 42);
    rulesData.current = "규칙 v2";
    const other = await frozenManifest(1, 43);
    expect(other.text).toContain("규칙 v2");
  });

  it("녹이면 다음 조립에서 디스크를 다시 본다 — 즉시 도달은 막지 않는다", async () => {
    await frozenManifest(1, 42);
    rulesData.current = "규칙 v2";
    thawManifest(1, 42);
    const fresh = await frozenManifest(1, 42);
    expect(fresh.text).toContain("규칙 v2");
  });

  it("매니페스트에는 안전 조항이 늘 있다", async () => {
    const m = await buildManifest(1);
    expect(m.text).toContain(".oculpm/index/**");
  });
});

describe("능력 검색 — 이름·설명·키워드만", () => {
  it("키워드로 스킬을 찾는다", async () => {
    const m = await buildManifest(1);
    const hits = discover(m, "채점");
    expect(hits.map((h) => h.label)).toContain("run-evals");
  });

  it("지시문 본문은 색인하지 않는다 — 없는 말은 안 걸린다", async () => {
    const m = await buildManifest(1);
    expect(discover(m, "존재하지않는말")).toEqual([]);
  });
});

describe("본문 요청 규약", () => {
  it("펜스 블록에서 요청을 읽는다", () => {
    const text = '설명입니다.\n\n```json:context\n{ "type": "load", "kind": "rules_master", "id": "" }\n```';
    expect(parseContextRequest(text)).toEqual({ type: "load", kind: "rules_master", id: "" });
  });

  it("검색 요청도 같은 블록으로 온다", () => {
    const text = '```json:context\n{ "type": "discover", "query": "테마" }\n```';
    expect(parseContextRequest(text)).toEqual({ type: "discover", query: "테마" });
  });

  it("깨진 JSON·모르는 kind 는 요청이 아니다 (조용히 무시)", () => {
    expect(parseContextRequest("```json:context\n{nope\n```")).toBeNull();
    expect(parseContextRequest('```json:context\n{ "type": "load", "kind": "evil" }\n```')).toBeNull();
    expect(parseContextRequest("그냥 답변")).toBeNull();
  });

  it("요청 블록은 사용자에게 보이지 않는다", () => {
    const text = '앞말\n\n```json:context\n{ "type": "discover", "query": "x" }\n```';
    expect(stripContextRequest(text)).toBe("앞말");
  });
});
