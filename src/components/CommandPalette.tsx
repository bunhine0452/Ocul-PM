import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Command } from "cmdk";
import {
  Settings as SettingsIcon,
  BookText,
  Code2,
  Columns3,
  FolderPlus,
  Keyboard,
  NotebookText,
  SquareTerminal,
  TargetIcon,
  type IconComponent,
} from "@/components/Icons";
import { useOptionalWorkspace, type UiV2View } from "@/contexts/WorkspaceContext";
import { NAV_DESTINATIONS, NAV_BUS, navShortcutLabel, type OpenEntityDetail } from "@/lib/navRegistry";
import { tAll, useT } from "@/i18n";
import type { HomeBrief, JournalSearchHit, PlanSummary, Project, ProjectAttention } from "@/lib/bindings";
import { oculpmApi } from "@/api/oculpm";
import { planApi } from "@/api/plan";
import { projectsApi } from "@/api/projects";
import { terminalApi, type TermInfo } from "@/api/terminal";
import { windowApi } from "@/api/window";
import { useModalBehavior } from "@/hooks/useModalBehavior";
import { kbd } from "@/lib/kbd";
import { matchScore } from "@/lib/choseong";
import { requestCheatsheet, requestTour } from "@/lib/projectActions";
import { toast } from "@/lib/toast";
import { dayWord } from "@/lib/workdayLabel";
import { ProjectRow, distinctWhere } from "@/features/shell/ProjectRow";
import { projectColorOf } from "@/features/shell/projectColor";
import { projectSlotLabel, slotsOf } from "@/features/shell/projectKeys";
import type { OpenSwitcherDetail } from "@/features/shell/ProjectSwitcher";
import { useOpenInEditor } from "@/features/shell/useOpenInEditor";
import { orderRecent } from "@/features/start/useRecentProjects";
import { requestTermFocus } from "@/features/terminal/focusRequest";
import { coalesce, countByProject, needsMe, sessionWord } from "@/features/terminal/status";
import "./palette.css";

// ⌘K 팔레트 (MASTER-GUIDE §5.9 → 4.0 → 11-15) — 「어디로」 에서 「무엇을」 까지.
//
// "UI 가 말을 듣지 않을 때 ⌘K 로 즉시 탈출" 의 장치다. 3.x 는 세션 시작·종료·수동 일지·
// 어댑터 동기·규칙·스킬·재색인까지 실었다가 4.0 에서 화면 · 프로젝트 · 일지 · 계획 넷으로 줄였다.
// 11-15 에 셋을 더 실었다: 터미널 세션(기다림 먼저 — 다른 창의 것도), 창 전역 동작(단축키 전체 ·
// 폴더 열기 · 편집기 · 창 정리 · 프로젝트 색 — ⌘O 에만 있던 것), 초성 검색. 고르기 점수는
// `lib/choseong.matchScore`(접두 > 단어 시작 > 부분 > 초성)이고 같으면 넣은 순서(최근 순)다.
// 시작 창도 같은 팔레트를 쓴다(워크스페이스가 없으면 화면 · 일지 · 계획 묶음이 빠진다).

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 설정 화면으로. */
  onOpenSettings: () => void;
  /** 다른 프로젝트 — 그 프로젝트의 창을 연다 (이미 열려 있으면 그 창이 앞으로). */
  projects?: Project[];
  onSelectProject?: (p: Project) => void;
  /** 「폴더 열기…」 — 주면 동작 묶음에 선다. */
  onOpenFolder?: () => void;
}

type CommandItem = {
  id: string;
  label: string;
  /** 검색 대상 — 라벨 · 양 언어 별칭. 영어 모드에서도 "일지" 로, 한국어 모드에서도 "journal" 로 찾힌다. */
  keywords: string[];
  icon?: IconComponent;
  /** 아이콘 대신 앞에 서는 것(프로젝트 색 점). */
  lead?: ReactNode;
  shortcut?: string;
  onSelect: () => void;
};

/** 일지 검색은 두 글자부터, 120ms 묶어서 — 한 글자는 거의 모든 일지에 걸린다. */
const MIN_QUERY = 2;
const DEBOUNCE_MS = 120;
const JOURNAL_LIMIT = 8;
/**
 * 일지 줄의 점수 — 백엔드가 이미 맞췄다. 늘 다른 줄보다 낮다(가장 낮은 초성 맞음이 1): 일지 답은 120ms + IPC 뒤에
 * 오는데, 위로 끼어들면 cmdk 가 고른 줄을 그대로 두어 목록이 눈앞에서 뛰고 고른 줄이 밀렸다. 일지만 맞는 검색이면
 * 그 묶음 혼자라 맨 위에 선다.
 */
const JOURNAL_SCORE = 0.5;

/** 세션의 이름 — 엔진이 붙이는 제목(선택 필드)이 있으면 그것, 없으면 셸 이름 · `claude`. */
function sessionName(s: TermInfo): string {
  const title = (s as TermInfo & { title?: string | null }).title;
  return title?.trim() || s.label;
}

/** 세션 줄 순서 — 내 손을 기다리는 것(이 창의 것 먼저, 오래 기다린 순), 이 창의 것, 다른 창의 것. ⌘J 의 차례와 같다. */
function sessionRank(s: TermInfo, currentProjectId: number | null): number {
  const here = s.project_id === currentProjectId;
  if (s.alive && needsMe(s.status)) return here ? 0 : 1;
  return here ? 2 : 3;
}

/** 고른 줄을 사람이 옮긴 키 — 이것을 누른 뒤로는 늦게 온 세션이 고른 줄을 가져가지 않는다. */
const MOVE_KEYS = new Set(["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"]);

function sinceMs(s: TermInfo): number {
  const ms = Date.parse(s.status?.since ?? s.started_at);
  return Number.isNaN(ms) ? 0 : ms;
}

export function CommandPalette({
  open,
  onOpenChange,
  onOpenSettings,
  projects,
  onSelectProject,
  onOpenFolder,
}: CommandPaletteProps) {
  const ws = useOptionalWorkspace();
  const currentProjectId = ws?.state.currentProjectId ?? null;
  const currentRoot = ws?.state.currentProjectRoot ?? null;
  const [search, setSearch] = useState("");
  const [journal, setJournal] = useState<{ query: string; hits: JournalSearchHit[] }>({ query: "", hits: [] });
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const [sessions, setSessions] = useState<TermInfo[]>([]);
  const [attention, setAttention] = useState<Map<number, ProjectAttention>>(new Map());
  const [brief, setBrief] = useState<HomeBrief | null>(null);
  const [openWindows, setOpenWindows] = useState<number[]>([]);
  const { t, lang } = useT();
  const editor = useOpenInEditor(currentRoot, open && currentRoot != null);

  // 닫히면 비운다 — 다음에 열 때 지난 검색어가 남아 있으면 놀란다.
  useEffect(() => {
    if (open) return;
    setSearch("");
    setJournal({ query: "", hits: [] });
  }, [open]);

  // 계획은 열 때 한 번 — 수가 적고(활성 몇 개) 제목으로 고른다.
  useEffect(() => {
    if (!open || currentProjectId == null) return;
    let alive = true;
    void planApi
      .list(currentProjectId)
      .then((list) => alive && setPlans(list.filter((p) => p.status === "active")))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open, currentProjectId]);

  // 터미널 세션 — 모든 창의 것. 열려 있는 동안 상태가 바뀌면(기다리기 시작 · 끝남) 따라 읽는다. 사건이 몰려 와도
  // 읽기는 한 번에 묶는다(`coalesce` — 읽을 때마다 백엔드가 「도는 중」 을 잰다, 11-11). 늦게 온 옛 답은 버린다.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    let seq = 0;
    const load = () => {
      const mine = ++seq;
      void Promise.resolve()
        .then(() => terminalApi.overview())
        .then((list) => alive && mine === seq && setSessions(Array.isArray(list) ? list : []))
        .catch(() => {});
    };
    load();
    const later = coalesce(load);
    const off = Promise.resolve()
      .then(() => terminalApi.onSessionsChanged(later.call))
      .catch(() => null);
    return () => {
      alive = false;
      later.cancel();
      void off.then((unlisten) => unlisten?.());
    };
  }, [open]);

  // 프로젝트 줄의 재료 — 최근 순서 · 기다림 · 「열림」. 열 때 한 번(⌘O 목록과 같은 칩을 단다).
  const projectsKey = (projects ?? []).map((p) => p.id).join(",");
  useEffect(() => {
    if (!open || !projectsKey) return;
    let alive = true;
    const ids = projectsKey.split(",").map(Number);
    void Promise.resolve()
      .then(() => windowApi.attention(ids))
      .then((a) => alive && setAttention(a))
      .catch(() => {});
    void Promise.resolve()
      .then(() => projectsApi.brief(1))
      .then((b) => alive && setBrief(b))
      .catch(() => {});
    void Promise.resolve()
      .then(() => windowApi.openProjectIds())
      .then((list) => alive && setOpenWindows(Array.isArray(list) ? list : []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open, projectsKey]);

  // 일지 — 백엔드 검색(`oculpm_search_journal`, MCP `journal_search` 와 같은 엔진).
  const query = search.trim();
  const canSearch = open && currentProjectId != null && query.length >= MIN_QUERY;
  useEffect(() => {
    const pid = currentProjectId;
    if (!canSearch || pid == null) {
      setJournal((j) => (j.hits.length === 0 && j.query === "" ? j : { query: "", hits: [] }));
      return;
    }
    // 디바운스는 요청 수만 줄인다 — 이미 나간 요청이 검색어가 바뀐 뒤에 돌아와 새 결과를
    // 덮지 않게 정리 함수에서 낡은 응답을 버린다.
    let stale = false;
    const timer = window.setTimeout(() => {
      void Promise.resolve()
        .then(() => oculpmApi.searchJournal(pid, query, undefined, JOURNAL_LIMIT))
        .then((page) => page.hits)
        .catch((): JournalSearchHit[] => [])
        .then((hits) => {
          if (!stale) setJournal({ query, hits });
        });
    }, DEBOUNCE_MS);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [canSearch, query, currentProjectId]);
  // 이 검색어의 답이 아직 안 왔다 — 「매칭되는 명령이 없어요」 가 먼저 깜빡이지 않게 정지 글자를 둔다.
  const searching = canSearch && journal.query !== query;
  const journalHits = journal.query === query ? journal.hits : [];

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  const run = useCallback(
    (fn: () => void) => () => {
      onOpenChange(false);
      fn();
    },
    [onOpenChange],
  );

  const openEntity = useCallback(
    (detail: OpenEntityDetail) => {
      onOpenChange(false);
      window.dispatchEvent(new CustomEvent(NAV_BUS.openEntity, { detail }));
    },
    [onOpenChange],
  );

  const go = useCallback(
    (view: UiV2View) => () => {
      ws?.setUiV2View(view);
      onOpenChange(false);
    },
    [ws, onOpenChange],
  );

  // ── 화면 — navRegistry 단일 소스. ⌘번호 라벨도 배열 순서에서 계산된다.
  const navItems: CommandItem[] = useMemo(
    () => [
      ...(ws ? NAV_DESTINATIONS : []).map((e) => ({
        id: `view-${e.id}`,
        label: t(e.labelKey),
        keywords: [t(e.labelKey), ...tAll(e.labelKey), ...tAll(e.aliasKey)],
        icon: e.icon,
        shortcut: navShortcutLabel(e.id),
        onSelect: go(e.id),
      })),
      {
        id: "view-settings",
        label: t("palette.openSettings"),
        keywords: tAll("palette.openSettings"),
        icon: SettingsIcon,
        shortcut: kbd("⌘,"),
        onSelect: run(onOpenSettings),
      },
    ],
    // `t` 는 언어가 바뀔 때만 아이덴티티가 바뀐다 (useT).
    [t, go, ws, run, onOpenSettings],
  );

  // ── 동작 — 창 어디서나 쓰는 동사. ⌘O 목록에만 있던 편집기 · 창 정리 · 프로젝트 색을 여기서도.
  const currentColor = projectColorOf(projects?.find((p) => p.id === currentProjectId)?.color);
  const actionItems: CommandItem[] = [
    {
      id: "act-cheatsheet",
      label: t("palette.cheatsheet"),
      keywords: [...tAll("palette.cheatsheet"), ...tAll("keys.title")],
      icon: Keyboard,
      shortcut: kbd("⌘/"),
      onSelect: run(requestCheatsheet),
    },
    // 첫 실행 안내를 다시 — 도움말 메뉴가 없는 Windows·Linux 에서는 여기가 유일한 길이다.
    { id: "act-tour", label: t("tour.title"), keywords: tAll("tour.title"), icon: BookText, onSelect: run(requestTour) },
    ...(onOpenFolder
      ? [{ id: "act-folder", label: t("sidebar.addFolder"), keywords: tAll("sidebar.addFolder"), icon: FolderPlus, onSelect: run(onOpenFolder) }]
      : []),
    ...(currentRoot
      ? [{ id: "act-editor", label: editor.label, keywords: [editor.label, ...tAll("sidebar.openInEditorGeneric")], icon: Code2, onSelect: run(() => editor.open("")) }]
      : []),
    ...(openWindows.length >= 2
      ? [
          {
            id: "act-tile",
            label: t("sidebar.tileWindows"),
            keywords: tAll("sidebar.tileWindows"),
            icon: Columns3,
            onSelect: run(() => {
              windowApi.tile().catch((e) => toast.warning(t("sidebar.tileWindowsFailed", { error: String(e?.message ?? e) })));
            }),
          },
        ]
      : []),
    ...(currentProjectId != null
      ? [
          {
            id: "act-color",
            label: t("palette.projectColor"),
            keywords: [...tAll("palette.projectColor"), ...tAll("sidebar.projectColor")],
            lead: <span className="proj-dot palette-dot" data-pc={currentColor} aria-hidden="true" />,
            // 색 견본은 ⌘O 목록 아래 묶음에 산다 — 그 목록을 색 칸에 포커스를 둔 채 연다.
            onSelect: run(() => {
              const detail: OpenSwitcherDetail = { focus: "colors" };
              window.dispatchEvent(new CustomEvent(NAV_BUS.openProjectSwitcher, { detail }));
            }),
          },
        ]
      : []),
  ];

  // ── 세션 — 기다림 먼저, 이 창 다음, 다른 창. 끝났어도 안 본 소식이 있으면 남는다.
  const sessionRows = useMemo(
    () =>
      sessions
        .filter((s) => s.alive || s.unseen)
        .map((s, i) => ({ s, i }))
        .sort((a, b) => {
          const ra = sessionRank(a.s, currentProjectId);
          const rb = sessionRank(b.s, currentProjectId);
          return ra - rb || (ra <= 1 ? sinceMs(a.s) - sinceMs(b.s) : a.i - b.i);
        })
        .map(({ s }) => s),
    [sessions, currentProjectId],
  );
  // 고른 줄 — 기다리는 세션이 오면 그 줄을 고른다(아직 아무것도 안 쳤고 줄을 옮기지도 않았을 때, 연 동안 한 번).
  // 이 창의 기다림이 있으면 ⌘K ↩ 가 ⌘J 의 첫 세션과 같은 곳에 간다. 다른 창의 세션은 그 창을 앞으로 가져올 뿐 그
  // 칸까지 고르지는 못한다. 세션 목록은 늦게 와서 그 사이 cmdk 가 첫 줄(오늘)을 골라 두는데, 사람이 이미 ↓ 로
  // 옮긴 줄은 빼앗지 않는다 — 그러면 ↩ 가 엉뚱한 곳에 갔다.
  const [selected, setSelected] = useState("");
  const preselected = useRef(false);
  const moved = useRef(false);
  useEffect(() => {
    if (open) return;
    preselected.current = false;
    moved.current = false;
    setSelected("");
  }, [open]);
  useEffect(() => {
    if (!open || preselected.current || moved.current || search) return;
    const first = sessionRows[0];
    if (!first || !first.alive || !needsMe(first.status)) return;
    preselected.current = true;
    setSelected(`session:${first.id}`);
  }, [open, sessionRows, search]);
  const projectName = (id: number) => projects?.find((p) => p.id === id)?.name ?? "";
  const pickSession = (s: TermInfo) => {
    onOpenChange(false);
    // 이 창의 세션이면 그 칸을 고른다(셸이 화면을 터미널로 옮긴다). 다른 창이면 그 창을 앞으로.
    if (s.project_id === currentProjectId) requestTermFocus(s.id);
    else windowApi.openProjectWindow(s.project_id).catch(() => {});
  };

  // ── 프로젝트 — 다른 프로젝트는 다른 창이다. 줄은 ⌘O 와 한 벌(`ProjectRow`), 번호는 최근 순.
  const recent = orderRecent(projects ?? [], brief);
  const others = onSelectProject ? recent.filter((p) => p.id !== currentProjectId) : [];
  const slots = ws ? slotsOf(recent, currentProjectId) : new Map<number, number>();
  const where = distinctWhere(projects ?? []);
  const terms = useMemo(() => countByProject(sessions), [sessions]);

  const filter = (value: string, q: string, keywords?: string[]) =>
    value.startsWith("journal:") ? JOURNAL_SCORE : matchScore(q, keywords ?? []);

  // Esc · Tab 트랩 · 닫힐 때 포커스 복원 — 다른 모달(AppDialog)과 같은 훅.
  const panelRef = useRef<HTMLDivElement | null>(null);
  useModalBehavior({ open, onClose: close, panelRef });

  if (!open) return null;

  const renderItem = (it: CommandItem) => {
    const Icon = it.icon;
    return (
      <Command.Item key={it.id} value={it.id} keywords={it.keywords} onSelect={it.onSelect} className="palette-item">
        {it.lead ?? (Icon ? <Icon size={15} aria-hidden="true" /> : null)}
        <span className="palette-label">{it.label}</span>
        {it.shortcut ? <kbd className="kbd">{it.shortcut}</kbd> : null}
      </Command.Item>
    );
  };

  return (
    <div
      data-home-overlay
      className="scrim z-command flex items-start justify-center pt-[18vh] p-4 animate-in fade-in duration-(--dur-2)"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <Command
        ref={panelRef}
        label={t("palette.aria")}
        role="dialog"
        aria-modal="true"
        aria-label={t("palette.aria")}
        className="palette animate-in zoom-in-95 duration-(--dur-2)"
        filter={filter}
        value={selected}
        onValueChange={setSelected}
        onKeyDown={(e) => {
          if (MOVE_KEYS.has(e.key) || (e.ctrlKey && "jknp".includes(e.key))) moved.current = true;
        }}
      >
        <Command.Input
          autoFocus
          value={search}
          onValueChange={setSearch}
          // 시작 창엔 화면 · 일지가 없다 — 찾을 수 없는 것을 자리표시가 약속하지 않게.
          placeholder={t(ws ? "palette.placeholder" : "palette.placeholderStart")}
          className="palette-input"
        />
        {/* 찾는 동안은 aria-busy — 줄이 아직 오는 중인 목록이다(그 사이 빈 목록을 「항목 없음」 으로 읽지 않게). */}
        <Command.List className="palette-list scrollbar-thin" label={t("palette.list")} aria-busy={searching || undefined}>
          {searching ? null : <Command.Empty className="palette-status">{t("palette.empty")}</Command.Empty>}
          {sessionRows.length > 0 ? (
            <Command.Group heading={t("palette.group.sessions")}>
              {sessionRows.map((s) => {
                const word = sessionWord(t, s);
                const waiting = s.alive && needsMe(s.status);
                const elsewhere = s.project_id !== currentProjectId ? projectName(s.project_id) : "";
                return (
                  <Command.Item
                    key={`session:${s.id}`}
                    value={`session:${s.id}`}
                    // 「터미널」 은 화면 줄의 이름이다 — 세션이 그 말에 같이 걸리면 화면 줄이 묻힌다.
                    keywords={[sessionName(s), elsewhere, word]}
                    onSelect={() => pickSession(s)}
                    className="palette-item"
                  >
                    <SquareTerminal size={15} aria-hidden="true" />
                    <span className="palette-label">{sessionName(s)}</span>
                    {elsewhere ? <span className="palette-meta">{elsewhere}</span> : null}
                    {waiting ? <span className="chip sm warn">{word}</span> : <span className="palette-meta">{word}</span>}
                  </Command.Item>
                );
              })}
            </Command.Group>
          ) : null}
          {navItems.length > 0 ? (
            <Command.Group heading={t("palette.group.nav")}>{navItems.map(renderItem)}</Command.Group>
          ) : null}
          <Command.Group heading={t("palette.group.actions")}>{actionItems.map(renderItem)}</Command.Group>
          {others.length > 0 && onSelectProject ? (
            <Command.Group heading={t("palette.group.projects")}>
              {others.map((p) => {
                const slot = slots.get(p.id);
                return (
                  <Command.Item
                    key={`project:${p.id}`}
                    value={`project:${p.id}`}
                    keywords={[p.name, p.root_path]}
                    onSelect={() => {
                      onSelectProject(p);
                      onOpenChange(false);
                    }}
                    className="palette-item palette-project"
                  >
                    <ProjectRow
                      project={p}
                      where={where.get(p.id)}
                      signals={{ attention: attention.get(p.id), terms: terms.get(p.id), open: openWindows.includes(p.id) }}
                      meta={slot != null ? <kbd className="kbd">{projectSlotLabel(slot)}</kbd> : null}
                    />
                  </Command.Item>
                );
              })}
            </Command.Group>
          ) : null}
          {plans.length > 0 ? (
            <Command.Group heading={t("palette.group.plans")}>
              {plans.map((p) => (
                <Command.Item
                  key={`plan:${p.plan_id}`}
                  value={`plan:${p.plan_id}`}
                  keywords={[p.title, p.plan_id]}
                  onSelect={() => openEntity({ kind: "plan", id: p.plan_id })}
                  className="palette-item"
                >
                  <TargetIcon size={15} aria-hidden="true" />
                  <span className="palette-label">{p.title}</span>
                  <span className="palette-meta">
                    {p.done_count}/{p.item_count}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}
          {journalHits.length > 0 ? (
            <Command.Group heading={t("palette.group.journal")}>
              {journalHits.map((hit) => (
                <Command.Item
                  key={`journal:${hit.relative_path}`}
                  value={`journal:${hit.relative_path}`}
                  // 백엔드가 이미 매칭했다 — 점수는 `filter` 가 묶음째 정한다.
                  keywords={[search]}
                  onSelect={() => openEntity({ kind: "journal", id: hit.relative_path })}
                  className="palette-item"
                >
                  <NotebookText size={15} aria-hidden="true" />
                  <span className="palette-label">{hit.title}</span>
                  <span className="palette-meta">{dayWord(hit.workday, lang, t)}</span>
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}
          {/* 찾는 중 — 일지 묶음이 설 자리(맨 끝)에 정지 글자 한 줄. 맨 위에 두면 맞은 줄이 있어도 글자 하나 칠 때마다
              줄 전체가 한 줄씩 내려갔다 올라왔다. 맞은 줄이 없으면 혼자라 판 가운데에 선다. 목록(listbox) 안이라
              status 같은 역할을 못 단다 — cmdk 의 빈 칸과 같이 presentation. */}
          {searching ? (
            <div className="palette-status" role="presentation">
              {t("palette.searching")}
            </div>
          ) : null}
        </Command.List>
        <div className="palette-foot">
          <span>
            <kbd className="kbd">↑↓</kbd> {t("palette.foot.move")}
          </span>
          <span>
            <kbd className="kbd">⏎</kbd> {t("palette.foot.open")}
          </span>
          {ws ? <span className="palette-foot-hint">{t("palette.footHint")}</span> : null}
        </div>
      </Command>
    </div>
  );
}
