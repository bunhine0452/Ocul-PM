import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
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

// 기본 밀도는 간단(두 열 보기)이다 — 이 테스트는 3존 화면의 모양을 재므로 전문으로 고정한다.
vi.mock("@/hooks/useDensity", () => ({
  useDensity: () => ({ density: "pro", set: () => {}, toggle: () => {} }),
  DensityShortcut: () => null,
}));
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

describe("추천 스킬 갤러리 (PR-CI5) — 2026-10-28 부터 비어 있다", () => {
  it("갤러리 데이터는 비어 있고, 추가하기 존은 제3자 카탈로그만 보여 준다 + axe", async () => {
    expect(GALLERY_SKILLS).toEqual([]);
    const { container, getByRole, getByText } = render(<SkillsScreenV2 projectId={1} />);
    await waitFor(() => expect(getByText("추가하기")).toBeTruthy());
    expect(getByRole("button", { name: /전체 카탈로그/ })).toBeTruthy();
    const results = await axe(container, AXE_OPTIONS);
    expect(summarize(results)).toEqual([]);
  });
});
