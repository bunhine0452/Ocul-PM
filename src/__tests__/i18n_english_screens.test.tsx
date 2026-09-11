import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";

// 영어 모드 **전 화면 순회** (v3-release {#i18n-rest}, 03-i18n.md §8 의 확장).
//
// `i18n_english_render.test.tsx` 는 모달·패널 일곱을 본다. 이 스위트는 나머지 —
// 사이드바와 16화면의 본체·툴바 — 를 영어로 실제로 그려서 한글이 남는지 본다.
// 정적 스캐너가 못 잡는 것(상수 표의 한글 · 모듈 `t()` 를 쓰는 memo · 옛
// 문자열을 계속 쓰는 소비처)을 화면 단위로 막는 마지막 그물이다.
//
// 데이터는 전부 빈 목록/`null` 이라 **빈 상태와 chrome** 을 검사한다. 데이터가
// 채워진 경로(일지 본문·플랜 항목)는 사용자 콘텐츠라 한국어가 정상이다.

vi.mock("@tauri-apps/api/core", () => ({
  Channel: class {
    onmessage: ((event: unknown) => void) | null = null;
  },
  invoke: () => Promise.resolve(),
}));

const ACP_SESSION = {
  agent: { name: "claude-code", title: "Claude Code", version: "0.76.0", auth_required: false, supports_image: true },
  commands: [],
  session_id: "sess-1",
  title: null,
  options: [],
};

vi.mock("@/lib/bindings", () => {
  const ok = <T,>(data: T) => Promise.resolve({ status: "ok" as const, data });
  return {
    commands: new Proxy(
      {},
      {
        get: (_t, prop) => {
          if (prop === "listProjects") return () => ok([]);
          if (prop === "settingsGetAll")
            return () => ok([["language", "en"]] as Array<[string, string]>);
          if (prop === "conversationList") return () => ok([]);
          if (prop === "planList") return () => ok([]);
          if (prop === "oculpmListJournalEntries") return () => ok([]);
          if (prop === "oculpmListSessions") return () => ok([]);
          if (prop === "claudePluginStatus") return () => Promise.resolve({ installed: false, path: null });
          if (prop === "appInfo") return () => ok({ name: "ocul-pm", version: "0.0.0" });
          if (prop === "secretHas") return () => ok(false);
          if (prop === "themeList") return () => ok([]);
          if (prop === "acpListSessions") return () => ok([]);
          if (prop === "acpStatus") return () => ok(null);
          if (prop === "acpStart" || prop === "acpNewSession") return () => ok(ACP_SESSION);
          if (prop === "acpUsage") return () => ok(null);
          if (prop === "gitUncommittedChanges") return () => ok([]);
          if (prop === "gitLog" || prop === "gitGraph") return () => ok([]);
          if (prop === "gitStatus")
            return () => ok({ is_git_repo: true, head_branch: "main", remotes: [], repo: null });
          if (prop === "a2aOverview")
            return () => ok({ participants: [], integrity: [], groups: [], leases: [], open_tasks: [] });
          if (prop === "a2aEndpointStatus") return () => ok({ running: false, port: null, url: null });
          if (prop === "branchList") return () => ok([]);
          if (prop === "discussionList") return () => ok([]);
          if (prop === "skillsList")
            return () => ok({ project: [], global: [], project_skills_dir: "/repo/.claude/skills", global_skills_dir: "~/.claude/skills" });
          if (prop === "rulesList")
            return () =>
              ok({
                claude_md: [],
                project_rules: [],
                global_rules: [],
                project_rules_dir: "/repo/.claude/rules",
                global_rules_dir: "~/.claude/rules",
                cursor_translate: false,
              });
          if (prop === "chatMessageList") return () => ok([]);
          if (prop === "codeTree") return () => ok({ nodes: [], file_count: 0, truncated: false });
          if (prop === "getCodeGraph") return () => ok({ nodes: [], edges: [] });
          if (prop === "oculpmWorkdayBrief")
            return () =>
              ok({ days: [], lines_added: 0, lines_removed: 0, files_touched: 0, open_plan_items: [], total_entries: 0 });
          if (prop === "codeDir") return () => ok({ entries: [], truncated: false });
          if (prop === "conversationCreate")
            return () =>
              ok({
                id: 1,
                title: "t",
                provider: null,
                model: null,
                project_id: 1,
                created_at: 0,
                updated_at: 0,
                last_message_at: null,
              });
          if (prop === "ruleCandidates" || prop === "skillCandidates") return () => ok([]);
          if (prop === "planRecentUpdates" || prop === "journalMissingSignals") return () => ok([]);
          if (prop === "dbHealth")
            return () => ok({ db_path: "", schema_version: 0, page_count: 0, integrity_ok: true });
          return () => ok(null);
        },
      },
    ),
    events: new Proxy({}, { get: () => ({ listen: () => Promise.resolve(() => {}) }) }),
  };
});

// `oculpmApi` 는 봉투를 벗겨 값으로 돌려주는 래퍼 — 메서드마다 화면이 기대하는
// **빈 모양**을 준다. 모양이 틀리면 화면이 오류 경계로 떨어져 영어 폴백만 남고,
// 실제 빈 상태는 검사에서 빠진다.
const EMPTY_BY_METHOD: Record<string, unknown> = {
  a2aOverview: { participants: [], integrity: [], groups: [], leases: [], open_tasks: [] },
  branchList: [],
  branchStory: null,
  listSessions: [],
  listJournalEntries: { entries: [], sessions: [] },
};
vi.mock("@/api/oculpm", () => ({
  oculpmApi: new Proxy(
    {},
    {
      get: (_t, prop) => async () =>
        typeof prop === "string" && prop in EMPTY_BY_METHOD
          ? EMPTY_BY_METHOD[prop]
          : { entries: [], sessions: [], items: [] },
    },
  ),
  OculpmApiError: class extends Error {},
}));

import { __resetLangForTests, setLangSetting, t } from "@/i18n";
import { WorkspaceProvider } from "@/contexts/WorkspaceContext";
import { SettingsProvider } from "@/contexts/SettingsContext";
import { Sidebar } from "@/components/Sidebar";
import { TodayScreenV2 } from "@/features/today/TodayScreenV2";
import { JournalScreenV2 } from "@/features/oculpm/JournalScreenV2";
import { DiffScreenV2 } from "@/features/diff/DiffScreenV2";
import { PlannerScreenV2 } from "@/features/planner/PlannerScreenV2";
import { SearchScreenV2 } from "@/features/search/SearchScreenV2";
import { DiscussionScreenV2 } from "@/features/discussion/DiscussionScreenV2";
import { SkillsScreenV2 } from "@/features/skills/SkillsScreenV2";
import { SessionsScreenV2 } from "@/features/sessions/SessionsScreenV2";
import { BranchScreenV2 } from "@/features/branch/BranchScreenV2";
import { AiPanelScreenV2 } from "@/features/chat/AiPanelScreenV2";
import { GraphScreenV2 } from "@/features/graph/GraphScreenV2";
import { CodeScreenV2 } from "@/features/code/CodeScreenV2";
import { ClaudeCodeScreenV2 } from "@/features/chat/ClaudeCodeScreenV2";
import { CodexScreenV2 } from "@/features/chat/CodexScreenV2";

// i18n-ignore-next-line -- 한글 **검출**용 정규식 (표시 문자열이 아니다)
const HANGUL = /[가-힣]/;
const SELF_NAMES = new Set(["한국어"]);

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <SettingsProvider>
      <WorkspaceProvider projectId={1}>{children}</WorkspaceProvider>
    </SettingsProvider>
  );
}

function hangulIn(root: HTMLElement): string[] {
  const found: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const v = (n.textContent ?? "").trim();
    if (v && HANGUL.test(v) && !SELF_NAMES.has(v)) found.push(v);
  }
  for (const el of root.querySelectorAll("[aria-label],[title],[placeholder]")) {
    for (const attr of ["aria-label", "title", "placeholder"]) {
      const v = el.getAttribute(attr);
      if (v && HANGUL.test(v) && !SELF_NAMES.has(v)) found.push(`${attr}="${v}"`);
    }
  }
  return [...new Set(found)];
}

/**
 * 언어 배선이 실제로 영어로 돌았는지 — 마커가 없으면 한글 0 은 공허하다.
 * 그리고 **화면이 오류 경계로 떨어지지 않았는지** — 폴백은 영어라 한글 검사를
 * 통과하지만 그건 빈 상태를 본 것이 아니다.
 */
async function expectEnglish(container: HTMLElement, marker: string) {
  await waitFor(() => {
    if (!container.textContent?.includes(marker)) throw new Error(`아직 "${marker}" 가 없다`);
  });
  expect(container.textContent, "오류 경계 폴백이 떴다").not.toContain(t("crash.title"));
  expect(hangulIn(container)).toEqual([]);
}

beforeEach(() => {
  localStorage.clear();
  setLangSetting("en");
});

afterEach(() => {
  cleanup();
  __resetLangForTests();
});

const noop = () => {};

describe("영어 모드 전 화면 순회 — 한글이 남지 않는다", () => {
  it("사이드바 (펼침)", async () => {
    const { container } = render(
      <Wrap>
        <Sidebar
          view="today"
          onNavigate={noop}
          projectName="ai-pm"
          projectPath="~/dev/ai-pm"
          onOpenProjectSwitcher={noop}
          currentProjectId={1}
          isDark={false}
          onToggleTheme={noop}
        />
      </Wrap>,
    );
    await expectEnglish(container, "Today");
  });

  it("Today", async () => {
    const { container } = render(
      <Wrap>
        <TodayScreenV2
          projectId={1}
          projectRoot="/repo"
          workday="20260911"
          dateLabel="Sep 11"
          tz="Asia/Seoul"
          oculpmReady
          onNavigate={noop}
        />
      </Wrap>,
    );
    await expectEnglish(container, "Today");
  });

  it("작업 일지", async () => {
    const { container } = render(
      <Wrap>
        <JournalScreenV2
          active
          projectId={1}
          todayKey="20260911"
          oculpmReady
          onOpenDiff={noop}
          focusPath={null}
          onFocusConsumed={noop}
          openEntryPath={null}
          onOpenEntryConsumed={noop}
        />
      </Wrap>,
    );
    await expectEnglish(container, "Journal");
  });

  it("변경 diff", async () => {
    const { container } = render(
      <Wrap>
        <DiffScreenV2 projectId={1} projectRoot="/repo" branch={null} onOpenEntry={noop} />
      </Wrap>,
    );
    await expectEnglish(container, "Diff");
  });

  it("플래너", async () => {
    const { container } = render(
      <Wrap>
        <PlannerScreenV2 projectId={1} onNavigate={noop} onOpenJournal={noop} />
      </Wrap>,
    );
    await expectEnglish(container, "Planner");
  });

  it("검색", async () => {
    const { container } = render(
      <Wrap>
        <SearchScreenV2 projectId={1} projectRoot="/repo" onOpenInCode={noop} />
      </Wrap>,
    );
    await expectEnglish(container, "Search");
  });

  it("논의", async () => {
    const { container } = render(
      <Wrap>
        <DiscussionScreenV2 projectId={1} onNavigate={noop} />
      </Wrap>,
    );
    await expectEnglish(container, "Discussion");
  });

  it("스킬", async () => {
    const { container } = render(
      <Wrap>
        <SkillsScreenV2 projectId={1} active />
      </Wrap>,
    );
    await expectEnglish(container, "Skills");
  });

  it("세션", async () => {
    const { container } = render(
      <Wrap>
        <SessionsScreenV2 projectId={1} />
      </Wrap>,
    );
    await expectEnglish(container, "Sessions");
  });

  it("브랜치", async () => {
    const { container } = render(
      <Wrap>
        <BranchScreenV2 projectId={1} active onOpenJournal={noop} onOpenFile={noop} />
      </Wrap>,
    );
    await expectEnglish(container, "Branch");
  });

  it("코드 맵", async () => {
    const { container } = render(
      <Wrap>
        <GraphScreenV2 projectId={1} projectRoot="/repo" onOpenInCode={noop} />
      </Wrap>,
    );
    await expectEnglish(container, "Code Map");
  });

  it("코드", async () => {
    const { container } = render(
      <Wrap>
        <CodeScreenV2 projectId={1} projectRoot="/repo" openTarget={null} onOpenTargetConsumed={noop} />
      </Wrap>,
    );
    await expectEnglish(container, "Editor");
  });

  it("Claude Code (ACP)", async () => {
    const { container } = render(
      <Wrap>
        <ClaudeCodeScreenV2 projectId={1} />
      </Wrap>,
    );
    await expectEnglish(container, "Claude Code");
  });

  it("Codex (ACP)", async () => {
    const { container } = render(
      <Wrap>
        <CodexScreenV2 projectId={1} />
      </Wrap>,
    );
    await expectEnglish(container, "Codex");
  });

  it("AI 대화 패널", async () => {
    const { container } = render(
      <Wrap>
        <AiPanelScreenV2 projectId={1} />
      </Wrap>,
    );
    await expectEnglish(container, "AI");
  });
});
