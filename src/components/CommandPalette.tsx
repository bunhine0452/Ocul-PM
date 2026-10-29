import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Command } from "cmdk";
import {
  Settings as SettingsIcon,
  BookText,
  FolderGit2,
  NotebookText,
  TargetIcon,
  type IconComponent,
} from "@/components/Icons";
import { useOptionalWorkspace, type UiV2View } from "@/contexts/WorkspaceContext";
import { NAV_DESTINATIONS, NAV_BUS, navShortcutLabel, type OpenEntityDetail } from "@/lib/navRegistry";
import { tAll, useT, type I18nKey } from "@/i18n";
import type { JournalSearchHit, PlanSummary, Project } from "@/lib/bindings";
import { oculpmApi } from "@/api/oculpm";
import { planApi } from "@/api/plan";
import { useModalBehavior } from "@/hooks/useModalBehavior";
import { kbd } from "@/lib/kbd";
import { requestTour } from "@/lib/projectActions";

// ⌘K 팔레트 (MASTER-GUIDE §5.9 → 4.0) — 네 가지만 싣는다: 화면 · 프로젝트 · 일지 · 계획.
//
// "UI 가 말을 듣지 않을 때 ⌘K 로 즉시 탈출" 의 장치다. 3.x 는 세션 시작·종료·수동 일지·
// 어댑터 동기·규칙·스킬·재색인까지 실었는데, 그 대부분은 앱 안 동작이 사라지며 함께
// 걷혔고, 남은 것도 그 화면에 버튼이 있다. 팔레트는 **어디로 가는 곳**이다.

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 설정 화면으로. */
  onOpenSettings: () => void;
  /** 다른 프로젝트 — 그 프로젝트의 창을 연다 (이미 열려 있으면 그 창이 앞으로). */
  projects?: Project[];
  onSelectProject?: (p: Project) => void;
}

type CommandGroup = "nav" | "projects";

const GROUP_LABEL: Record<CommandGroup, I18nKey> = {
  nav: "palette.group.nav",
  projects: "palette.group.projects",
};

type CommandItem = {
  id: string;
  label: string;
  /** 양 언어 별칭 — 영어 모드에서도 "일지" 로, 한국어 모드에서도 "journal" 로 찾힌다. */
  alias?: string;
  group: CommandGroup;
  icon: IconComponent;
  shortcut?: string;
  onSelect: () => void;
};

/** 일지 검색은 두 글자부터, 120ms 묶어서 — 한 글자는 거의 모든 일지에 걸린다. */
const MIN_QUERY = 2;
const DEBOUNCE_MS = 120;
const JOURNAL_LIMIT = 8;

const HEADING =
  "[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-fs-3 [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground";
const ITEM =
  "flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer text-sm aria-selected:bg-accent aria-selected:text-foreground text-foreground/80";

export function CommandPalette({ open, onOpenChange, onOpenSettings, projects, onSelectProject }: CommandPaletteProps) {
  const ws = useOptionalWorkspace();
  const currentProjectId = ws?.state.currentProjectId ?? null;
  const [search, setSearch] = useState("");
  const [journalHits, setJournalHits] = useState<JournalSearchHit[]>([]);
  const [plans, setPlans] = useState<PlanSummary[]>([]);
  const { t } = useT();

  // 닫히면 비운다 — 다음에 열 때 지난 검색어가 남아 있으면 놀란다.
  useEffect(() => {
    if (open) return;
    setSearch("");
    setJournalHits([]);
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

  // 일지 — 백엔드 검색(`oculpm_search_journal`, MCP `journal_search` 와 같은 엔진).
  useEffect(() => {
    const q = search.trim();
    const pid = currentProjectId;
    if (!open || pid == null || q.length < MIN_QUERY) {
      setJournalHits([]);
      return;
    }
    // 디바운스는 요청 수만 줄인다 — 이미 나간 요청이 검색어가 바뀐 뒤에 돌아와 새 결과를
    // 덮지 않게 정리 함수에서 낡은 응답을 버린다.
    let stale = false;
    const timer = window.setTimeout(() => {
      void Promise.resolve()
        .then(() => oculpmApi.searchJournal(pid, q, undefined, JOURNAL_LIMIT))
        .then((page) => page.hits)
        .catch((): JournalSearchHit[] => [])
        .then((hits) => {
          if (!stale) setJournalHits(hits);
        });
    }, DEBOUNCE_MS);
    return () => {
      stale = true;
      window.clearTimeout(timer);
    };
  }, [open, search, currentProjectId]);

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

  const items: CommandItem[] = useMemo(
    () => [
      // ── 화면 — navRegistry 단일 소스. ⌘번호 라벨도 배열 순서에서 계산된다.
      ...(ws ? NAV_DESTINATIONS : []).map((e) => ({
        id: `view-${e.id}`,
        label: t(e.labelKey),
        alias: [...tAll(e.aliasKey), ...tAll(e.labelKey)].join(" "),
        group: "nav" as const,
        icon: e.icon,
        shortcut: navShortcutLabel(e.id),
        onSelect: go(e.id),
      })),
      {
        id: "view-settings",
        label: t("palette.openSettings"),
        alias: tAll("palette.openSettings").join(" "),
        group: "nav" as const,
        icon: SettingsIcon,
        shortcut: kbd("⌘,"),
        onSelect: () => {
          onOpenSettings();
          onOpenChange(false);
        },
      },
      // 첫 실행 안내를 다시 — 도움말 메뉴가 없는 Windows·Linux 에서는 여기가 유일한 길이다.
      {
        id: "help-tour",
        label: t("tour.title"),
        alias: tAll("tour.title").join(" "),
        group: "nav" as const,
        icon: BookText,
        onSelect: () => {
          onOpenChange(false);
          requestTour();
        },
      },
      // ── 프로젝트 — 다른 프로젝트는 다른 창이다.
      ...(projects && onSelectProject
        ? projects
            .filter((p) => p.id !== currentProjectId)
            .map((p) => ({
              id: `open-project-${p.id}`,
              label: p.name,
              alias: p.root_path,
              group: "projects" as const,
              icon: FolderGit2,
              onSelect: () => {
                onSelectProject(p);
                onOpenChange(false);
              },
            }))
        : []),
    ],
    // `t` 는 언어가 바뀔 때만 아이덴티티가 바뀐다 (useT).
    [t, go, ws, onOpenChange, onOpenSettings, projects, onSelectProject, currentProjectId],
  );

  const grouped = useMemo(() => {
    const groups = {} as Record<CommandGroup, CommandItem[]>;
    items.forEach((it) => {
      (groups[it.group] ??= []).push(it);
    });
    return Object.entries(groups) as Array<[CommandGroup, CommandItem[]]>;
  }, [items]);

  // Esc · Tab 트랩 · 닫힐 때 포커스 복원 — 다른 모달(AppDialog)과 같은 훅.
  const panelRef = useRef<HTMLDivElement | null>(null);
  const close = useCallback(() => onOpenChange(false), [onOpenChange]);
  useModalBehavior({ open, onClose: close, panelRef });

  if (!open) return null;

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
        className="w-full max-w-xl bg-card border border-border rounded-xl shadow-xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-(--dur-2)"
        // 별칭을 검색 대상에 넣는다 — 한국어 검색어가 영어 라벨에 걸리고 그 반대도.
        filter={(value, query, keywords) => {
          const haystack = `${value} ${(keywords ?? []).join(" ")}`.toLowerCase();
          return haystack.includes(query.toLowerCase()) ? 1 : 0;
        }}
      >
        <Command.Input
          autoFocus
          value={search}
          onValueChange={setSearch}
          placeholder={t("palette.placeholder")}
          className="w-full px-4 py-3 bg-transparent border-0 border-b border-border outline-none text-sm placeholder:text-muted-foreground"
        />
        <Command.List className="max-h-[60vh] overflow-y-auto scrollbar-thin p-1">
          <Command.Empty className="px-4 py-6 text-sm text-muted-foreground text-center">
            {t("palette.empty")}
          </Command.Empty>
          {grouped.map(([group, list]) => (
            <Command.Group key={group} heading={t(GROUP_LABEL[group])} className={HEADING}>
              {list.map((it) => {
                const Icon = it.icon;
                return (
                  <Command.Item
                    key={it.id}
                    value={it.label}
                    keywords={it.alias ? [it.alias] : []}
                    onSelect={it.onSelect}
                    className={ITEM}
                  >
                    <Icon className="text-muted-foreground" size={15} />
                    <span className="flex-1">{it.label}</span>
                    {it.shortcut && <kbd className="text-fs-1 text-muted-foreground font-mono">{it.shortcut}</kbd>}
                  </Command.Item>
                );
              })}
            </Command.Group>
          ))}
          {plans.length > 0 ? (
            <Command.Group heading={t("palette.group.plans")} className={HEADING}>
              {plans.map((p) => (
                <Command.Item
                  key={`plan:${p.plan_id}`}
                  value={`plan:${p.plan_id} ${p.title}`}
                  keywords={[p.title, p.plan_id]}
                  onSelect={() => openEntity({ kind: "plan", id: p.plan_id })}
                  className={ITEM}
                >
                  <TargetIcon className="text-muted-foreground" size={15} />
                  <span className="flex-1 truncate">{p.title}</span>
                  <span className="text-fs-3 text-muted-foreground shrink-0">
                    {p.done_count}/{p.item_count}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}
          {journalHits.length > 0 ? (
            <Command.Group heading={t("palette.group.journal")} className={HEADING}>
              {journalHits.map((hit) => (
                <Command.Item
                  key={`journal:${hit.relative_path}`}
                  value={`journal:${hit.relative_path}`}
                  // 백엔드가 이미 매칭했다 — cmdk 필터를 항상 통과시킨다.
                  keywords={[search]}
                  onSelect={() => openEntity({ kind: "journal", id: hit.relative_path })}
                  className={ITEM}
                >
                  <NotebookText className="text-muted-foreground" size={15} />
                  <span className="flex-1 truncate">{hit.title}</span>
                  <span className="text-fs-3 text-muted-foreground shrink-0">{hit.workday}</span>
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}
        </Command.List>
        <div className="palette-foot">
          <span>
            <kbd>↑↓</kbd> {t("palette.foot.move")}
          </span>
          <span>
            <kbd>⏎</kbd> {t("palette.foot.open")}
          </span>
          <span className="palette-foot-hint">{t("palette.footHint")}</span>
        </div>
      </Command>
    </div>
  );
}
