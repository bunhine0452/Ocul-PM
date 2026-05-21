import { useEffect, useMemo, useState } from "react";
import { Command } from "cmdk";
import {
  LayoutDashboard,
  Flame,
  Calendar,
  FileCode,
  Code2,
  Settings as SettingsIcon,
  RefreshCw,
  Sparkles,
  Network,
  GitBranch,
  Terminal as TerminalIcon,
} from "@/components/Icons";
import {
  useWorkspace,
  type ActiveView,
  type CodeSubTab,
} from "@/contexts/WorkspaceContext";

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
  group: "이동" | "액션" | "Code 화면";
  icon: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  onSelect: () => void;
};

export function CommandPalette({
  open,
  onOpenChange,
  onOpenSettings,
  onReindex,
  onRegenerateOverview,
}: CommandPaletteProps) {
  const { setActiveView, openInCode, state } = useWorkspace();
  const [search, setSearch] = useState("");

  // Reset query when palette closes — feels less surprising on next open.
  useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  const go = (view: ActiveView) => () => {
    setActiveView(view);
    onOpenChange(false);
  };
  const goCode = (sub: CodeSubTab) => () => {
    openInCode(sub);
    onOpenChange(false);
  };

  const items: CommandItem[] = useMemo(
    () => [
      // ── Top-level navigation
      { id: "view-overview",  label: "Overview", alias: "개요 정체성",
        group: "이동", icon: LayoutDashboard, shortcut: "⌘1", onSelect: go("overview") },
      { id: "view-today",     label: "Today", alias: "오늘 일정 포커스",
        group: "이동", icon: Flame,           shortcut: "⌘2", onSelect: go("today") },
      { id: "view-plan",      label: "Plan", alias: "플래너 목표 goal",
        group: "이동", icon: Calendar,         shortcut: "⌘3", onSelect: go("plan") },
      { id: "view-changelog", label: "Changelog", alias: "체인지로그 변경 기록",
        group: "이동", icon: FileCode,         shortcut: "⌘4", onSelect: go("changelog") },
      { id: "view-code",      label: "Code", alias: "코드 워크벤치",
        group: "이동", icon: Code2,            shortcut: "⌘5", onSelect: go("code") },

      // ── Code sub-tabs (transitional — UI-5 absorbs these later)
      { id: "code-files",    label: "Code — Files", alias: "파일 탐색기",
        group: "Code 화면", icon: FileCode,        onSelect: goCode("files") },
      { id: "code-ai",      label: "Code — AI", alias: "채팅 어시스트 quick edit",
        group: "Code 화면", icon: Sparkles,        onSelect: goCode("ai") },
      { id: "code-graph",    label: "Code — Graph", alias: "의존성 그래프",
        group: "Code 화면", icon: Network,         onSelect: goCode("graph") },
      { id: "code-terminal", label: "Code — Terminal", alias: "터미널",
        group: "Code 화면", icon: TerminalIcon,    onSelect: goCode("terminal") },
      { id: "code-git",      label: "Code — Git", alias: "깃 로그",
        group: "Code 화면", icon: GitBranch,       onSelect: goCode("git") },

      // ── Actions
      { id: "settings", label: "Settings 열기", alias: "설정",
        group: "액션", icon: SettingsIcon, shortcut: "⌘,",
        onSelect: () => { onOpenSettings(); onOpenChange(false); } },
      ...(onReindex && state.currentProjectId !== null
        ? [{ id: "reindex", label: "프로젝트 재인덱싱", alias: "reindex 재색인",
            group: "액션" as const, icon: RefreshCw, onSelect: () => { onReindex(); onOpenChange(false); } }]
        : []),
      ...(onRegenerateOverview && state.currentProjectId !== null
        ? [{ id: "regen-overview", label: "Overview 다시 생성", alias: "개요 재생성",
            group: "액션" as const, icon: Sparkles, onSelect: () => { onRegenerateOverview(); onOpenChange(false); } }]
        : []),
    ],
    [onOpenChange, onOpenSettings, onReindex, onRegenerateOverview, state.currentProjectId],
  );

  // Group items by `group` field, preserving the original order so the
  // "이동" group always renders before "Code 화면" / "액션".
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
        label="Command Palette"
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
