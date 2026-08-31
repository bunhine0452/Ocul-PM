import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, fireEvent, waitFor } from "@testing-library/react";
import { axe } from "vitest-axe";
import type { AxeResults, Result } from "axe-core";

// ─── PR-CI5 추천 스킬 — AD-3 이후 자리: 존 3 "추가하기" ────────────────────
//
// 갤러리는 모달이었는데, 5탭 허브가 3존 화면으로 접히면서 **샵 탭과 함께 존 3
// 의 "추가하기" 로 흡수**됐다. 쇼핑 표면이 둘(모달·탭)이던 것을 하나로 줄인
// 것이고, 데이터·설치 계약은 그대로다.
//
// 설치는 기존 skills_save(create=true) 재사용이 전부다 — 갤러리 전용 백엔드가
// 없다는 것 자체가 계약이므로, 여기서는 (a) 템플릿 노출, (b) 설치 클릭 →
// skillsSave 인자, (c) 이미 있는 스킬은 "설치됨" 으로 버튼 비노출을 고정한다.

const summarize = (r: AxeResults) =>
  r.violations.map((v: Result) => ({ id: v.id, help: v.help, nodes: v.nodes.length }));

const AXE_OPTIONS = {
  rules: { "color-contrast": { enabled: false }, region: { enabled: false } },
} as const;

type Dict = Record<string, unknown>;

function skillEntry(dirName: string): Dict {
  return {
    scope: "project",
    dir_name: dirName,
    name: dirName,
    description: "",
    enabled: true,
    display_path: `.claude/skills/${dirName}`,
    extra_files: 0,
  };
}

const fx = {
  project: [] as Dict[],
  calls: { save: [] as unknown[][] },
};

vi.mock("@/components/Markdown", () => ({
  Markdown: ({ children }: { children: string }) => children,
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  revealItemInDir: vi.fn(),
}));

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          switch (prop) {
            case "skillsList":
              return () =>
                ok({
                  project: fx.project,
                  global: [],
                  project_skills_dir: "/tmp/proj/.claude/skills",
                  global_skills_dir: "/home/u/.claude/skills",
                });
            case "skillsRead":
              return (_p: number, _s: string, dirName: string) =>
                ok({
                  entry: skillEntry(dirName),
                  content: `---\nname: ${dirName}\n---\n\n# ${dirName}\n`,
                  files: [],
                  skill_md_path: `/abs/${dirName}/SKILL.md`,
                });
            case "skillsSave":
              return (...a: unknown[]) => {
                fx.calls.save.push(a);
                return ok(skillEntry(String(a[2])));
              };
            default:
              return () => ok(null);
          }
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

import { SkillsScreenV2 } from "@/features/skills/SkillsScreenV2";
import { GALLERY_SKILLS } from "@/features/skills/skillsGallery";

beforeEach(() => {
  fx.project = [];
  fx.calls.save = [];
});

afterEach(() => {
  cleanup();
});

describe("추천 스킬 갤러리 (PR-CI5)", () => {
  it("갤러리 데이터 — 3종 템플릿과 run-evals 의 기록 표 규약", () => {
    expect(GALLERY_SKILLS.map((g) => g.id)).toEqual(["project-inception", "self-audit", "run-evals", "tdd-workflow"]);
    for (const g of GALLERY_SKILLS) {
      expect(g.content.startsWith(`---\nname: ${g.id}\n`), g.id).toBe(true);
      expect(g.content, g.id).toContain("description:");
    }
    // PR-CI6 회고 eval 추이가 파싱하는 표 형식이 템플릿에 정의돼 있어야 한다.
    const runEvals = GALLERY_SKILLS.find((g) => g.id === "run-evals")!;
    expect(runEvals.content).toContain("## 기록");
    expect(runEvals.content).toContain("| 날짜 | 스위트 | 통과 | 메모 |");
  });

  it("존 3 추가하기에 큐레이션 4종이 서고, 설치 클릭이 skillsSave(create=true) 를 부른다 + axe", async () => {
    const { container, getByRole, getByText, getAllByRole } = render(<SkillsScreenV2 projectId={1} />);
    await waitFor(() => expect(getByText("추가하기")).toBeTruthy());

    // 큐레이션 4종이 모달 없이 화면에 그대로 있다 (진입 클릭 0회).
    for (const g of GALLERY_SKILLS) expect(getByText(new RegExp(g.id))).toBeTruthy();

    const installButtons = getAllByRole("button", { name: "설치" });
    expect(installButtons.length).toBeGreaterThanOrEqual(GALLERY_SKILLS.length);
    fireEvent.click(installButtons[0]);

    await waitFor(() => expect(fx.calls.save).toHaveLength(1));
    const [pid, scope, dirName, content, create] = fx.calls.save[0] as [
      number,
      string,
      string,
      string,
      boolean,
    ];
    expect([pid, scope, dirName, create]).toEqual([1, "project", "project-inception", true]);
    expect(content).toBe(GALLERY_SKILLS[0].content);
    expect(getByRole("button", { name: /전체 카탈로그/ })).toBeTruthy();

    const results = await axe(container, AXE_OPTIONS);
    expect(summarize(results)).toEqual([]);
  });

  it("이미 설치된 스킬은 '설치됨' 으로 표시되고 설치 버튼이 없다 (중복 가드)", async () => {
    fx.project = [skillEntry("run-evals")];
    const { findAllByText, getAllByRole, getAllByText } = render(<SkillsScreenV2 projectId={1} />);
    await findAllByText("run-evals");

    expect(getAllByText("설치됨").length).toBe(1);
    // 큐레이션 4종 중 하나가 빠진 만큼 설치 버튼도 하나 줄어든다.
    expect(getAllByRole("button", { name: "설치" }).length).toBe(GALLERY_SKILLS.length - 1);
  });
});
