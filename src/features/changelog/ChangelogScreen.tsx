import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Loader2,
  RefreshCw,
  Flame,
  Search,
  Save,
  ChevronDown,
} from "@/components/Icons";
import {
  commands,
  type ChangelogEntry,
  type ChangelogFileEntry,
  type DailyChangelogBucket,
} from "@/lib/bindings";
import { EntryDetail } from "./EntryDetail";
import { CategoryChip, truncate } from "./util";

// MASTER-GUIDE §5.5 — Changelog 화면 (W4 정식 버전).
//   좌측: 날짜 버킷 / 우측: EntryDetail (모달 diff 포함)
//   상단: 카테고리 chip · 기간 · 검색 · Export 메뉴
//   📌 고정은 Today 화면과 직접 연동 (TodayScreen 이 pinned_entries 를 fetch).

const CATEGORIES = ["all", "feature", "fix", "refactor", "docs", "test", "chore"] as const;
type CategoryFilter = (typeof CATEGORIES)[number];

const WINDOWS = [
  { label: "최근 7일", days: 7 },
  { label: "최근 30일", days: 30 },
  { label: "최근 90일", days: 90 },
];

interface ChangelogScreenProps {
  activeProjectId: number | null;
}

export function ChangelogScreen({ activeProjectId }: ChangelogScreenProps) {
  const [buckets, setBuckets] = useState<DailyChangelogBucket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ entry: ChangelogEntry; files: ChangelogFileEntry[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [windowDays, setWindowDays] = useState<number>(30);
  const [searchQuery, setSearchQuery] = useState("");

  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    if (activeProjectId == null) return;
    setLoading(true);
    setError(null);
    const res = await commands.listChangelogByDay(activeProjectId, windowDays);
    if (res.status === "ok") setBuckets(res.data);
    else setError((res as any).error ?? "불러오기 실패");
    setLoading(false);
  }, [activeProjectId, windowDays]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (selectedEntryId == null) {
      setDetail(null);
      return;
    }
    setDetailLoading(true);
    commands.getChangelogDetail(selectedEntryId).then((res) => {
      if (res.status === "ok") {
        const [entry, files] = res.data;
        setDetail({ entry, files });
      } else {
        setError((res as any).error ?? "디테일 로드 실패");
        setDetail(null);
      }
      setDetailLoading(false);
    });
  }, [selectedEntryId]);

  /** Filter pipeline: category → text search. Search hits title / ai_summary /
   *  user_intent / category, case-insensitive. Empty buckets are dropped. */
  const filteredBuckets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return buckets
      .map((b) => {
        let entries = b.entries;
        if (categoryFilter !== "all") {
          entries = entries.filter((e) => e.category === categoryFilter);
        }
        if (q.length > 0) {
          entries = entries.filter((e) => {
            const hay = [
              e.title ?? "",
              e.ai_summary ?? "",
              e.user_intent ?? "",
              e.category ?? "",
            ]
              .join(" ")
              .toLowerCase();
            return hay.includes(q);
          });
        }
        return { ...b, entries };
      })
      .filter((b) => b.entries.length > 0);
  }, [buckets, categoryFilter, searchQuery]);

  function applyEntryUpdate(updated: ChangelogEntry) {
    if (detail?.entry.id === updated.id) {
      setDetail({ entry: updated, files: detail.files });
    }
    setBuckets((prev) =>
      prev.map((b) => ({
        ...b,
        entries: b.entries.map((e) => (e.id === updated.id ? updated : e)),
      })),
    );
  }

  async function doExport(kind: "md" | "json") {
    if (activeProjectId == null) return;
    setExporting(true);
    setExportOpen(false);

    try {
      let content: string;
      let filename: string;
      const stamp = new Date().toISOString().slice(0, 10);

      if (kind === "md") {
        const res = await commands.exportChangelogMarkdown(activeProjectId, null, null);
        if (res.status !== "ok") {
          setError((res as any).error ?? "Export 실패");
          return;
        }
        content = res.data;
        filename = `changelog-${stamp}.md`;
      } else {
        // JSON: re-use the in-memory buckets so we don't round-trip to the backend
        // just to serialise. Source of truth is the same list_changelog_by_day
        // payload the screen already has.
        content = JSON.stringify({ exported_at: new Date().toISOString(), buckets }, null, 2);
        filename = `changelog-${stamp}.json`;
      }

      // Trigger a browser-style download. Works inside Tauri's webview and
      // avoids adding the @tauri-apps/plugin-fs/dialog JS dependency just
      // for this one action.
      const blob = new Blob([content], {
        type: kind === "md" ? "text/markdown" : "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(String(e));
    } finally {
      setExporting(false);
    }
  }

  if (activeProjectId == null) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        프로젝트를 먼저 선택해주세요.
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header / Filters */}
      <header className="border-b border-border px-5 py-3 flex flex-wrap items-center gap-3 shrink-0">
        <h1 className="text-base font-bold tracking-tight">Changelog</h1>

        <div className="flex items-center gap-1.5">
          {CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              className={`px-2 py-0.5 rounded-full text-[11px] font-semibold border transition-colors ${
                categoryFilter === c
                  ? "bg-primary text-primary-foreground border-primary"
                  : "border-border text-muted-foreground hover:text-foreground hover:bg-accent/40"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <div className="relative flex-1 min-w-[160px] max-w-md ml-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="제목 · 요약 · 의도 검색"
            className="pl-7 h-7 text-xs"
          />
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              onClick={() => setWindowDays(w.days)}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors ${
                windowDays === w.days
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {w.label}
            </button>
          ))}

          <ExportMenu
            open={exportOpen}
            onOpenChange={setExportOpen}
            onExport={doExport}
            disabled={exporting}
          />

          <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
          </Button>
        </div>
      </header>

      {error && (
        <div className="m-3 text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3">
          {error}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {/* Left: day buckets */}
        <div className="w-[320px] border-r border-border overflow-y-auto scrollbar-thin shrink-0">
          {filteredBuckets.length === 0 && !loading && (
            <div className="p-6 text-xs text-muted-foreground">
              {searchQuery.trim() || categoryFilter !== "all"
                ? "필터에 맞는 entry 가 없습니다."
                : "해당 기간에 기록된 변경이 없습니다. Code 화면에서 변경사항을 changelog 로 저장하면 여기에 누적됩니다."}
            </div>
          )}
          {filteredBuckets.map((bucket) => (
            <div key={bucket.date} className="border-b border-border/60">
              <div className="px-4 py-2 bg-secondary/30 text-[11px] font-bold tabular-nums flex items-center justify-between">
                <span>{bucket.date}</span>
                <span className="text-muted-foreground font-normal">
                  {bucket.entries.length} · +{bucket.total_lines_added} / -{bucket.total_lines_removed}
                </span>
              </div>
              <ul>
                {bucket.entries.map((e) => (
                  <li key={e.id}>
                    <button
                      onClick={() => setSelectedEntryId(e.id)}
                      className={`w-full text-left px-4 py-2.5 hover:bg-accent/40 transition-colors border-l-2 ${
                        selectedEntryId === e.id
                          ? "border-primary bg-accent/30"
                          : "border-transparent"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        {e.category && <CategoryChip category={e.category} />}
                        {e.pinned && <Flame className="w-3 h-3 text-amber-500" />}
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {new Date(e.created_at * 1000).toLocaleTimeString("ko-KR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <div className="text-sm font-medium leading-snug mt-0.5">
                        {e.title ?? truncate(e.ai_summary, 60)}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5 tabular-nums">
                        {e.files_changed} files · +{e.lines_added} / -{e.lines_removed}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Right: detail */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {!selectedEntryId && (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              왼쪽에서 entry 를 선택해주세요.
            </div>
          )}
          {selectedEntryId && detailLoading && (
            <div className="p-6 text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> 디테일 로드 중…
            </div>
          )}
          {detail && (
            <EntryDetail
              entry={detail.entry}
              files={detail.files}
              onChange={applyEntryUpdate}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Export dropdown ──────────────────────────────────────────────────

function ExportMenu({
  open,
  onOpenChange,
  onExport,
  disabled,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExport: (kind: "md" | "json") => void;
  disabled: boolean;
}) {
  return (
    <div className="relative">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onOpenChange(!open)}
        disabled={disabled}
        className="h-7"
      >
        <Save className="w-3.5 h-3.5 mr-1.5" />
        Export
        <ChevronDown className="w-3 h-3 ml-1" />
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => onOpenChange(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 w-44 bg-card border border-border rounded-lg shadow-lg overflow-hidden">
            <button
              onClick={() => onExport("md")}
              className="w-full text-left px-3 py-2 text-xs hover:bg-accent/50 transition-colors flex items-center gap-2"
            >
              <span className="font-mono text-muted-foreground">.md</span>
              Markdown (Keep-a-Changelog)
            </button>
            <button
              onClick={() => onExport("json")}
              className="w-full text-left px-3 py-2 text-xs hover:bg-accent/50 transition-colors flex items-center gap-2"
            >
              <span className="font-mono text-muted-foreground">.json</span>
              JSON (raw 버킷)
            </button>
          </div>
        </>
      )}
    </div>
  );
}
