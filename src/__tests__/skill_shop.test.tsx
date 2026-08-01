// 스킬 샵 탭 — 브라우징·추천·검색·설치의 동작 검증.
// 게이트 없음이 의도(스킬은 Claude Code 네이티브 — 플러그인 불필요)라서,
// "플러그인 미설치 상태에서도 렌더된다"가 회귀 조건이다.
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const skillsSave = vi.fn();
const detectStack = vi.fn();
const skillsList = vi.fn();

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          switch (prop) {
            case "skillsList":
              return (...a: unknown[]) => {
                skillsList(...a);
                return ok({
                  project: [{ dir_name: "vue-patterns", scope: "project" }],
                  global: [],
                });
              };
            case "detectStack":
              return (...a: unknown[]) => {
                detectStack(...a);
                return ok(["frontend", "javascript", "vue"]);
              };
            case "skillsSave":
              return (...a: unknown[]) => {
                skillsSave(...a);
                return ok(null);
              };
            default:
              return () => ok(null);
          }
        },
      },
    ),
  };
});
vi.mock("@/lib/toast", () => ({
  toast: { info: vi.fn(), destructive: vi.fn() },
}));

import { SkillShopTab } from "@/features/skills/SkillShopTab";
import { CATALOG_SKILLS } from "@/features/skills/skillsCatalog";

describe("스킬 샵 탭", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it("플러그인 여부와 무관하게 렌더되고, 전체 카탈로그 수를 표시한다", async () => {
    render(<SkillShopTab projectId={1} tabs={null} />);
    expect(
      await screen.findByText(`전체 카탈로그 (${CATALOG_SKILLS.length})`),
    ).toBeInTheDocument();
    // 게이트 없음: 플러그인 상태를 묻는 어떤 커맨드도 호출하지 않는다.
    expect(detectStack).toHaveBeenCalledWith(1);
    expect(skillsList).toHaveBeenCalledWith(1);
  });

  it("감지된 스택(vue)과 태그가 겹치는 스킬을 추천 섹션에 보여준다", async () => {
    render(<SkillShopTab projectId={1} tabs={null} />);
    await waitFor(() => {
      expect(screen.queryByText("스택 감지 중…")).not.toBeInTheDocument();
    });
    const heading = screen.getByText("이 프로젝트 스택 추천");
    const section = heading.closest("section");
    expect(section).not.toBeNull();
    // vue-patterns 는 vue 태그 매칭 + 설치됨(프로젝트 스코프 동명 폴더).
    const sec = within(section as HTMLElement);
    expect(sec.getByText(/vue-patterns/)).toBeInTheDocument();
    expect(sec.getByText("설치됨")).toBeInTheDocument();
  });

  it("검색어로 전체 카탈로그를 좁힌다", async () => {
    render(<SkillShopTab projectId={1} tabs={null} />);
    const input = await screen.findByLabelText("카탈로그 검색");
    fireEvent.change(input, { target: { value: "database-migrations" } });
    // 검색 결과 행 = database-migrations 하나만 (추천 섹션은 검색과 무관).
    const rows = screen.getAllByRole("listitem");
    const rowTexts = rows.map((r) => r.textContent ?? "");
    expect(rowTexts.some((t) => t.includes("database-migrations"))).toBe(true);
    expect(rowTexts.some((t) => t.includes("python-patterns"))).toBe(false);
  });

  it("미설치 스킬의 설치 버튼이 skillsSave 를 프로젝트 스코프로 부른다", async () => {
    render(<SkillShopTab projectId={7} tabs={null} />);
    const input = await screen.findByLabelText("카탈로그 검색");
    fireEvent.change(input, { target: { value: "api-design" } });
    // 추천 섹션에도 설치 버튼이 있으므로 전체 카탈로그 섹션으로 스코프.
    const catalogSec = screen.getByText(/^전체 카탈로그/).closest("section") as HTMLElement;
    const installBtn = await within(catalogSec).findByRole("button", { name: "설치" });
    fireEvent.click(installBtn);
    await waitFor(() => {
      expect(skillsSave).toHaveBeenCalledTimes(1);
    });
    const [pid, scope, id, content, create] = skillsSave.mock.calls[0];
    expect(pid).toBe(7);
    expect(scope).toBe("project");
    expect(id).toBe("api-design");
    expect(typeof content).toBe("string");
    expect(create).toBe(true);
  });

  it("행을 클릭하면 미리보기 모달이 열리고 원본(핀 커밋) 링크를 보여준다", async () => {
    render(<SkillShopTab projectId={1} tabs={null} />);
    const input = await screen.findByLabelText("카탈로그 검색");
    fireEvent.change(input, { target: { value: "inherit-legacy-style" } });
    const catalogSec = screen.getByText(/^전체 카탈로그/).closest("section") as HTMLElement;
    const meta = within(catalogSec).getByTitle("클릭해서 본문 미리보기");
    fireEvent.click(meta);
    const dialog = await screen.findByRole("dialog");
    const link = within(dialog).getByRole("link", { name: /원본/ });
    expect(link.getAttribute("href")).toMatch(/^https:\/\/github\.com\/.+\/blob\/[0-9a-f]{40}\//);
  });
});
