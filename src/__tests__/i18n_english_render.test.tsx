import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

// 영어 모드 렌더 계약 (docs/20260811_three-features/03-i18n.md §8).
//
// 정적 스캐너(`pnpm lint`)는 **소스에 한글 리터럴이 있는가**만 본다. 그래서
// 구조적으로 못 잡는 것들이 남는다:
//
//  - 상수 테이블에 남은 한글이 `t()` 를 안 거치고 렌더까지 흘러가는 경우
//  - `memo` 컴포넌트가 모듈 `t()` 를 써서 언어 전환에 안 따라오는 경우
//  - 사전 키는 있는데 소비처가 옛 문자열을 계속 쓰는 경우
//
// 그래서 **실제로 그려서** 한글이 남는지 본다. 이 스위트만 언어를 `en` 으로
// 뒤집는다 — 나머지 스위트는 `setup.ts` 가 `ko` 로 고정한 채로 둔다.

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "listProjects") return () => ok([]);
          // 언어를 **설정 경로로** 넘긴다. `setLangSetting("en")` 만으로는
          // 부족하다 — SettingsProvider 의 effect 가 저장된 값을 스토어로
          // 밀어넣으며 덮어쓴다 (setup.ts 가 같은 함정을 기록해 뒀다).
          // 이렇게 해야 배선 전체(DB → 컨텍스트 → 스토어 → t())가 검증된다.
          if (prop === "settingsGetAll")
            return () => ok([["language", "en"]] as Array<[string, string]>);
          if (prop === "conversationList") return () => ok([]);
          if (prop === "planList") return () => ok([]);
          if (prop === "oculpmListJournalEntries") return () => ok([]);
          if (prop === "oculpmListSessions") return () => ok([]);
          if (prop === "claudePluginStatus") return () => Promise.resolve({ installed: false, path: null });
          if (prop === "appInfo") return () => ok({ name: "ocul-pm", version: "0.0.0" });
          if (prop === "secretHas") return () => ok(false);
          if (prop === "dbHealth")
            return () => ok({ db_path: "", schema_version: 0, page_count: 0, integrity_ok: true });
          return () => ok(null);
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

vi.mock("@/api/oculpm", () => ({
  oculpmApi: new Proxy({}, { get: () => async () => ({ entries: [], sessions: [] }) }),
  OculpmApiError: class extends Error {},
}));

import { __resetLangForTests, setLangSetting } from "@/i18n";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { ConversationHistoryModal } from "@/features/chat/ConversationHistoryModal";
import { ProjectManager } from "@/features/projects/ProjectManager";
import { PluginDocsTab } from "@/features/skills/PluginDocsTab";

// i18n-ignore-next-line -- 한글 **검출**용 정규식 (표시 문자열이 아니다)
const HANGUL = /[가-힣]/;

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <SettingsProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </SettingsProvider>
  );
}

/**
 * 렌더된 DOM 에서 한글을 찾는다. 텍스트뿐 아니라 `aria-label` / `title` /
 * `placeholder` 도 훑는다 — 번역 누락의 상당수가 거기 숨는다(스캐너 실측
 * 기준 aria-label 만 275곳).
 */
function hangulIn(root: HTMLElement): string[] {
  const found: string[] = [];
  const text = root.textContent ?? "";
  for (const chunk of text.split(/\s{2,}|\n/)) {
    if (HANGUL.test(chunk)) found.push(chunk.trim());
  }
  for (const el of root.querySelectorAll("[aria-label],[title],[placeholder]")) {
    for (const attr of ["aria-label", "title", "placeholder"]) {
      const v = el.getAttribute(attr);
      if (v && HANGUL.test(v)) found.push(`${attr}="${v}"`);
    }
  }
  return [...new Set(found)];
}

beforeEach(() => {
  localStorage.clear();
  setLangSetting("en");
});

afterEach(() => {
  cleanup();
  __resetLangForTests();
});

describe("영어 모드에서 한글이 남지 않는다", () => {
  it("대화 기록 모달", async () => {
    const { container, findByText } = render(
      <Wrap>
        <ConversationHistoryModal
          projectId={1}
          activeId={null}
          onSelect={() => {}}
          onNew={() => {}}
          onActiveDeleted={() => {}}
          onClose={() => {}}
        />
      </Wrap>,
    );
    await findByText("Conversation history");
    expect(hangulIn(container)).toEqual([]);
  });

  it("프로젝트 관리 모달", async () => {
    const { container, findByText } = render(
      <Wrap>
        <ProjectManager
          projects={[]}
          brief={null}
          indexingId={null}
          onClose={() => {}}
          onOpenProject={() => {}}
          onRenameProject={() => {}}
          onDeleteProject={() => {}}
          onAddProject={() => {}}
          onStartGreenfield={() => {}}
          onProjectsChanged={() => {}}
        />
      </Wrap>,
    );
    await findByText("Manage projects");
    expect(hangulIn(container)).toEqual([]);
  });

  it("플러그인 안내 탭 — chrome 만 (데이터는 플러그인 거울이라 한국어가 정상)", async () => {
    const { findByText } = render(
      <Wrap>
        <PluginDocsTab tabs={null} />
      </Wrap>,
    );
    // 이 탭은 pluginDocs.ts(플러그인 실표면의 거울)를 그대로 렌더하므로
    // 전체 한글 0 을 요구할 수 없다 — chrome 이 영어인지만 확인한다.
    await findByText("Skills & rules");
    await findByText("Suggested flow");
  });
});
