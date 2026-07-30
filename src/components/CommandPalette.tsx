import { useEffect, useMemo, useRef, useState } from "react";
import { Command } from "cmdk";
import {
  Flame,
  Settings as SettingsIcon,
  RefreshCw,
  Sparkles,
  Plus,
  FolderGit2,
  NotebookText,
  TargetIcon,
  MessageSquare,
  BookText,
} from "@/components/Icons";
import { useWorkspace, type UiV2View } from "@/contexts/WorkspaceContext";
import { NAV_ENTRIES, NAV_BUS, navShortcutLabel, type OpenEntityDetail } from "@/lib/navRegistry";
import { commands, type DocsTreeNode, type EntityHit } from "@/lib/bindings";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import { toast } from "@/lib/toast";
import { requestManualEntry } from "@/lib/journalCompose";

// MASTER-GUIDE §5.9 — cmdk 기반 Command Palette
//
// ⌘K (Ctrl+K) 로 호출하는 fuzzy-search 인터페이스.
// 화면 이동, 액션, 검색을 한 곳에 모은다.
// "UI 가 말을 듣지 않을 때 ⌘K 로 즉시 탈출" 의 핵심 장치.

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Open Settings deep-link (handled by parent which owns the Settings overlay). */
  onOpenSettings: () => void;
  /** Trigger a project re-index (parent owns the indexing state). */
  onReindex?: () => void;
  /** Trigger overview regeneration. */
  onRegenerateOverview?: () => void;
}

type CommandItem = {
  id: string;
  label: string;
  // Korean alias for fuzzy matching ("체인지로그" → Changelog)
  alias?: string;
  group: "이동" | "액션" | "ocul-pm";
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  onSelect: () => void;
};

/**
 * Global event channel for CommandPalette ocul-pm actions that need to mount
 * UI in another component tree (ManualEntryModal owned by TodayScreen).
 *
 * Listeners live in TodayScreen and the app shell. Keeps the palette decoupled
 * from `useState` chains that would otherwise need to thread through `App`.
 */
export const OCULPM_BUS = {
  manualEntry: "oculpm:request-manual-entry",
} as const;

export function CommandPalette({
  open,
  onOpenChange,
  onOpenSettings,
  onReindex,
  onRegenerateOverview,
}: CommandPaletteProps) {
  const { setUiV2View, state } = useWorkspace();
  const [search, setSearch] = useState("");

  // Reset query when palette closes — feels less surprising on next open.
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  // ── v2 U7 — 엔티티 점프 ("go to anything") ────────────────────────────
  // 입력 2자 이상이면 120ms debounce 로 일지·플랜·토의 제목을 백엔드 캐시에서,
  // docs 파일명을 (팔레트가 열려 있는 동안 1회 캐시한) docs_tree 에서 찾는다.
  const [entityHits, setEntityHits] = useState<EntityHit[]>([]);
  const [docHits, setDocHits] = useState<{ path: string; name: string }[]>([]);
  const docsFlatRef = useRef<{ path: string; name: string }[] | null>(null);

  useEffect(() => {
    if (!open) {
      setEntityHits([]);
      setDocHits([]);
      docsFlatRef.current = null;
    }
  }, [open]);

  useEffect(() => {
    const q = search.trim();
    const pid = state.currentProjectId;
    if (!open || pid == null || q.length < 2) {
      setEntityHits([]);
      setDocHits([]);
      return;
    }
    const timer = window.setTimeout(() => {
      void commands.oculpmSearchEntities(pid, q, 8).then((res) => {
        setEntityHits(res.status === "ok" ? res.data : []);
      });
      const lower = q.toLowerCase();
      const filterDocs = (files: { path: string; name: string }[]) =>
        files
          .filter(
            (f) =>
              f.name.toLowerCase().includes(lower) || f.path.toLowerCase().includes(lower),
          )
          .slice(0, 4);
      if (docsFlatRef.current) {
        setDocHits(filterDocs(docsFlatRef.current));
      } else {
        void commands.docsTree(pid).then((res) => {
          if (res.status !== "ok" || !res.data.exists) {
            docsFlatRef.current = [];
            setDocHits([]);
            return;
          }
          const flat: { path: string; name: string }[] = [];
          const walk = (nodes: DocsTreeNode[]) => {
            for (const n of nodes) {
              if (n.is_dir) walk(n.children);
              else if (n.name.endsWith(".md")) flat.push({ path: n.relative_path, name: n.name });
            }
          };
          walk(res.data.nodes);
          docsFlatRef.current = flat;
          setDocHits(filterDocs(flat));
        });
      }
    }, 120);
    return () => window.clearTimeout(timer);
  }, [open, search, state.currentProjectId]);

  const openEntity = (detail: OpenEntityDetail) => {
    onOpenChange(false);
    window.dispatchEvent(new CustomEvent(NAV_BUS.openEntity, { detail }));
  };

  const entityIcon = (kind: EntityHit["kind"]) =>
    kind === "journal" ? NotebookText : kind === "discussion" ? MessageSquare : TargetIcon;

  const go = (view: UiV2View) => () => {
    setUiV2View(view);
    onOpenChange(false);
  };

  const items: CommandItem[] = useMemo(
    () => [
      // ── 이동 — navRegistry 단일 소스에서 파생 (v2 U1). 사이드바의 모든
      // 화면이 자동으로 여기 나타나고, ⌘번호 라벨도 배열 순서에서 계산된다.
      ...NAV_ENTRIES.map((e) => ({
        id: `view-${e.id}`,
        label: e.label,
        alias: e.alias,
        group: "이동" as const,
        icon: e.icon,
        shortcut: navShortcutLabel(e.id),
        onSelect: go(e.id),
      })),

      // ── 액션
      { id: "switch-project", label: "프로젝트 전환", alias: "project switch 프로젝트 전환 바꾸기",
        group: "액션", icon: FolderGit2, shortcut: "⌘P",
        onSelect: () => {
          onOpenChange(false);
          window.dispatchEvent(new CustomEvent(NAV_BUS.openProjectSwitcher));
        } },
      { id: "open-ai-panel", label: "AI 패널 열기", alias: "ai panel chat 채팅 ⌘\\",
        group: "액션", icon: Sparkles, shortcut: "⌘\\",
        onSelect: () => { setUiV2View("ai"); onOpenChange(false); } },
      { id: "settings", label: "설정 열기", alias: "settings 설정",
        group: "액션", icon: SettingsIcon, shortcut: "⌘,",
        onSelect: () => { onOpenSettings(); onOpenChange(false); } },
      ...(onReindex && state.currentProjectId !== null
        ? [{ id: "reindex", label: "프로젝트 재인덱싱", alias: "reindex 재색인",
            group: "액션" as const, icon: RefreshCw, onSelect: () => { onReindex(); onOpenChange(false); } }]
        : []),
      ...(onRegenerateOverview && state.currentProjectId !== null
        ? [{ id: "regen-overview", label: "개요 다시 생성", alias: "overview 개요 재생성",
            group: "액션" as const, icon: Sparkles, onSelect: () => { onRegenerateOverview(); onOpenChange(false); } }]
        : []),

      // ── ocul-pm — W4-PR8
      ...(state.currentProjectId !== null
        ? [
            {
              id: "oculpm-session-start",
              label: "세션 수동 시작",
              alias: "ocul-pm session start 세션 시작",
              group: "ocul-pm" as const,
              icon: Flame,
              onSelect: () => {
                const pid = state.currentProjectId!;
                onOpenChange(false);
                oculpmApi
                  .startSessionManual(pid)
                  .then((s) => toast.info(`세션 시작: ${s?.id ?? "(no id)"}`))
                  .catch((e) =>
                    toast.destructive(
                      e instanceof OculpmApiError ? e.message : String(e),
                    ),
                  );
              },
            },
            {
              id: "oculpm-session-end",
              label: "세션 수동 종료",
              alias: "ocul-pm session end 세션 종료",
              group: "ocul-pm" as const,
              icon: Flame,
              onSelect: () => {
                const pid = state.currentProjectId!;
                onOpenChange(false);
                const sid = state.currentSession?.id;
                if (!sid) {
                  toast.warning("종료할 활성 세션이 없습니다.");
                  return;
                }
                oculpmApi
                  .endSessionManual(pid, sid)
                  .then(() => toast.info(`세션 종료: ${sid}`))
                  .catch((e) =>
                    toast.destructive(
                      e instanceof OculpmApiError ? e.message : String(e),
                    ),
                  );
              },
            },
            {
              id: "oculpm-manual-entry",
              label: "수동 작업 기록 작성",
              alias: "ocul-pm manual entry journal 수동 기록",
              group: "ocul-pm" as const,
              icon: Plus,
              onSelect: () => {
                onOpenChange(false);
                // 2026-07-30: 이벤트만 쏘던 것을 sticky one-shot 으로 교체.
                // 작업 일지 화면이 마운트돼 있지 않으면 이벤트가 그대로
                // 사라져 이 항목이 아무 일도 하지 않았다.
                requestManualEntry();
              },
            },
            {
              id: "oculpm-sync-agents",
              label: "어댑터 규칙 다시 보내기",
              alias: "ocul-pm sync agents 동기화 어댑터",
              group: "ocul-pm" as const,
              icon: RefreshCw,
              onSelect: () => {
                const pid = state.currentProjectId!;
                onOpenChange(false);
                oculpmApi
                  .syncAgents(pid)
                  .then((report) => {
                    const updated = report.results.filter(
                      (r) => r.action === "inserted" || r.action === "updated",
                    ).length;
                    toast.info(`동기화 완료 (${updated} 어댑터 갱신)`);
                  })
                  .catch((e) =>
                    toast.destructive(
                      e instanceof OculpmApiError ? e.message : String(e),
                    ),
                  );
              },
            },
            {
              id: "oculpm-settings",
              label: "ocul-pm 설정",
              alias: "ocul-pm settings 설정",
              group: "ocul-pm" as const,
              icon: SettingsIcon,
              onSelect: () => {
                onOpenSettings();
                onOpenChange(false);
              },
            },
          ]
        : []),
    ],
    [onOpenChange, onOpenSettings, onReindex, onRegenerateOverview, state.currentProjectId, state.currentSession],
  );

  // Group items by `group` field, preserving the original order so the
  // "이동" group always renders before "코드 화면" / "액션".
  const grouped = useMemo(() => {
    const groups: Record<string, CommandItem[]> = {};
    items.forEach((it) => {
      (groups[it.group] ??= []).push(it);
    });
    return Object.entries(groups);
  }, [items]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-background/60 backdrop-blur-sm flex items-start justify-center pt-[18vh] p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <Command
        label="명령 팔레트"
        className="w-full max-w-xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-150"
        // cmdk uses a custom fuzzy match. Provide alias as searchable text so
        // Korean queries hit English labels and vice versa.
        filter={(value, search, keywords) => {
          const haystack = `${value} ${(keywords ?? []).join(" ")}`.toLowerCase();
          return haystack.includes(search.toLowerCase()) ? 1 : 0;
        }}
      >
        <Command.Input
          autoFocus
          value={search}
          onValueChange={setSearch}
          placeholder="화면 이동, 액션, 검색…"
          className="w-full px-4 py-3 bg-transparent border-0 border-b border-border outline-none text-sm placeholder:text-muted-foreground"
        />
        <Command.List className="max-h-[60vh] overflow-y-auto scrollbar-thin p-1">
          <Command.Empty className="px-4 py-6 text-sm text-muted-foreground text-center">
            매칭되는 명령이 없습니다.
          </Command.Empty>
          {entityHits.length + docHits.length > 0 ? (
            <Command.Group
              heading="바로가기"
              className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              {entityHits.map((hit) => {
                const Icon = entityIcon(hit.kind);
                return (
                  <Command.Item
                    key={`ent:${hit.kind}:${hit.id}`}
                    value={`ent:${hit.kind}:${hit.id}`}
                    // 백엔드가 이미 매칭했다 — cmdk 필터를 항상 통과시킨다.
                    keywords={[search]}
                    onSelect={() => openEntity({ kind: hit.kind, id: hit.id })}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer text-sm aria-selected:bg-accent aria-selected:text-foreground text-foreground/80"
                  >
                    <Icon className="w-4 h-4 text-muted-foreground" />
                    <span className="flex-1 truncate">{hit.title}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {hit.subtitle}
                    </span>
                  </Command.Item>
                );
              })}
              {docHits.map((doc) => (
                <Command.Item
                  key={`ent:doc:${doc.path}`}
                  value={`ent:doc:${doc.path}`}
                  keywords={[search]}
                  onSelect={() => openEntity({ kind: "doc", id: doc.path })}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer text-sm aria-selected:bg-accent aria-selected:text-foreground text-foreground/80"
                >
                  <BookText className="w-4 h-4 text-muted-foreground" />
                  <span className="flex-1 truncate">{doc.name}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0 truncate max-w-[40%]">
                    {doc.path}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}
          {grouped.map(([group, list]) => (
            <Command.Group
              key={group}
              heading={group}
              className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-muted-foreground"
            >
              {list.map((it) => {
                const Icon = it.icon;
                return (
                  <Command.Item
                    key={it.id}
                    value={it.label}
                    keywords={it.alias ? [it.alias] : []}
                    onSelect={it.onSelect}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer text-sm aria-selected:bg-accent aria-selected:text-foreground text-foreground/80"
                  >
                    <Icon className="w-4 h-4 text-muted-foreground" />
                    <span className="flex-1">{it.label}</span>
                    {it.shortcut && (
                      <kbd className="text-[10px] text-muted-foreground font-mono">
                        {it.shortcut}
                      </kbd>
                    )}
                  </Command.Item>
                );
              })}
            </Command.Group>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}
