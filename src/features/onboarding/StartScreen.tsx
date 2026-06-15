/**
 * StartScreen — 프로젝트 미선택 상태의 진입 화면 (MASTER-GUIDE §5.7)
 *
 * 기존 Dashboard 컴포넌트를 대체. 두 가지 진입 경로를 제공:
 *  - 📂 기존 폴더 불러오기 (folder picker)
 *  - ✨ 새 프로젝트 시작하기 (Greenfield Wizard)
 *
 * 추가로 미완성 blueprint 복원/삭제 UI와 최근 프로젝트 카드를 표시.
 */
import { useEffect, useMemo, useState } from "react";
import {
  commands,
  type Project,
  type ProjectStats,
  type ProjectBlueprint,
  type JournalEntrySummary,
} from "@/lib/bindings";
import { oculpmApi } from "@/api/oculpm";
import {
  FolderCode,
  FolderOpen,
  RefreshCw,
  Pencil,
  Trash2,
  Sparkles,
  Plus,
  Settings,
  Clock,
  ArrowRight,
  Bot,
  NotebookText,
} from "../../components/Icons";
import { BrandMark } from "../../components/BrandMark";

type StatsMap = Record<number, ProjectStats>;

// ── Cockpit home (Dogfooding 2026-06-14c #2) ────────────────────────────────
// The main screen aggregates *cross-project* journal activity so opening the app
// surfaces the product's core value (auto-recorded work) at a glance — not just a
// project picker. Trigger hues are hardcoded here because the --t-* tokens live
// in the ShellV2 chunk (tokens.css), which isn't loaded on this dashboard.
interface FeedItem {
  projectId: number;
  projectName: string;
  entry: JournalEntrySummary;
}
interface CockpitData {
  feed: FeedItem[];
  todayCount: number;
  todayByProject: Record<number, number>;
  /** ISO created_at of each project's most recent entry (for "마지막 활동"). */
  lastByProject: Record<number, string>;
}
const TYPE_TONE: Record<string, { label: string; color: string }> = {
  feature: { label: "기능", color: "#12a06b" },
  bug: { label: "버그", color: "#e0524b" },
  refactor: { label: "리팩토링", color: "#7c5cdb" },
  error: { label: "에러", color: "#d9881f" },
  chore: { label: "잡일", color: "#5a7a95" },
};

/** Calendar today as a YYYYMMDD workday key (local). */
function calToday(): string {
  const d = new Date();
  return (
    d.getFullYear().toString().padStart(4, "0") +
    (d.getMonth() + 1).toString().padStart(2, "0") +
    d.getDate().toString().padStart(2, "0")
  );
}
function hhmm(iso: string): string {
  const m = /T(\d{2}:\d{2})/.exec(iso);
  return m ? m[1] : "";
}

interface StartScreenProps {
  projects: Project[];
  stats: StatsMap;
  indexingId: number | null;
  error: string | null;
  onSelectProject: (p: Project) => void;
  onAddProject: () => void;
  onRenameProject: (p: Project) => void;
  onDeleteProject: (p: Project) => void;
  onOpenSettings: () => void;
  onStartGreenfield: () => void;
}

export function StartScreen(props: StartScreenProps) {
  const {
    projects,
    stats,
    indexingId,
    error,
    onSelectProject,
    onAddProject,
    onRenameProject,
    onDeleteProject,
    onOpenSettings,
    onStartGreenfield,
  } = props;

  const [blueprints, setBlueprints] = useState<ProjectBlueprint[]>([]);
  const [addExpanded, setAddExpanded] = useState(false);
  const [cockpit, setCockpit] = useState<CockpitData | null>(null);

  // macOS uses titleBarStyle "Overlay" (src-tauri/src/lib.rs) — the webview
  // reaches the very top under the floating traffic lights, with no title bar
  // to grab. The main page (pre-project) had no Toolbar, so the window was only
  // draggable at the window edges. Reserve a full-width drag strip at the top.
  // Windows/Linux keep native decorations, so the strip is macOS-only.
  const isMac =
    typeof navigator !== "undefined" && navigator.platform.toUpperCase().includes("MAC");

  useEffect(() => {
    loadBlueprints();
  }, []);

  // Aggregate cross-project journal activity for the cockpit. One list call per
  // project (cached SQLite read — works even when no watcher is running), bucketed
  // client-side into the recent feed, today's count, and a 7-day sparkline.
  useEffect(() => {
    if (projects.length === 0) {
      setCockpit(null);
      return;
    }
    let alive = true;
    const todayKey = calToday();
    void (async () => {
      const results = await Promise.allSettled(
        // Promise.resolve().then(...) so a synchronous throw (e.g. a project whose
        // oculpm cache isn't reachable) becomes a handled rejection, not an
        // unhandled error.
        projects.map((p) =>
          Promise.resolve()
            .then(() => oculpmApi.listJournalEntries(p.id))
            .then((list) => ({ p, list })),
        ),
      );
      if (!alive) return;
      const feed: FeedItem[] = [];
      const todayByProject: Record<number, number> = {};
      const lastByProject: Record<number, string> = {};
      let todayCount = 0;
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        const { p, list } = r.value;
        for (const e of list) {
          feed.push({ projectId: p.id, projectName: p.name, entry: e });
          if (!lastByProject[p.id] || e.created_at > lastByProject[p.id]) {
            lastByProject[p.id] = e.created_at;
          }
          if (e.workday === todayKey) {
            todayCount += 1;
            todayByProject[p.id] = (todayByProject[p.id] ?? 0) + 1;
          }
        }
      }
      feed.sort((a, b) => b.entry.created_at.localeCompare(a.entry.created_at));
      setCockpit({ feed: feed.slice(0, 10), todayCount, todayByProject, lastByProject });
    })();
    return () => {
      alive = false;
    };
  }, [projects]);

  function handleChooseExisting() {
    setAddExpanded(false);
    onAddProject();
  }

  function handleChooseGreenfield() {
    setAddExpanded(false);
    onStartGreenfield();
  }

  async function loadBlueprints() {
    const res = await commands.listBlueprints();
    if (res.status === "ok") setBlueprints(res.data);
  }

  async function handleDeleteBlueprint(id: number) {
    const res = await commands.deleteBlueprint(id);
    if (res.status === "ok") {
      setBlueprints((prev) => prev.filter((b) => b.id !== id));
    }
  }

  const stepLabels = ["아이디어", "사용자", "스택", "위치", "목표"];

  function relativeTime(unixSec: number): string {
    const now = Math.floor(Date.now() / 1000);
    const diff = now - unixSec;
    if (diff < 60) return "방금 전";
    if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
    return `${Math.floor(diff / 86400)}일 전`;
  }

  // Surface what you're actively working on: projects with today's activity
  // float up, then most-recently-active. Falls back to the given order.
  const displayProjects = useMemo(() => {
    if (!cockpit) return projects;
    const { todayByProject, lastByProject } = cockpit;
    return [...projects].sort((a, b) => {
      const ta = todayByProject[a.id] ?? 0;
      const tb = todayByProject[b.id] ?? 0;
      if (ta !== tb) return tb - ta;
      return (lastByProject[b.id] ?? "").localeCompare(lastByProject[a.id] ?? "");
    });
  }, [projects, cockpit]);

  return (
    // Full-height scroll container — the parent (App) is `h-screen overflow-hidden`,
    // so the page itself must own the scroll or it clips on short windows
    // (dogfooding 2026-06-15: main page wasn't scrollable).
    <main className="h-full overflow-y-auto scrollbar-thin">
      {isMac && (
        // Window drag strip — sits over the top edge (under the native traffic
        // lights, which capture their own clicks). z-20 keeps it above page
        // content but below modals/overlays (z-[90]+). The hero starts ~48px
        // down, so this 34px strip covers only empty space.
        <div
          data-tauri-drag-region
          className="fixed top-0 left-0 right-0 h-[34px] z-20"
          aria-hidden="true"
        />
      )}
      <div className="p-8 max-w-5xl mx-auto w-full space-y-10">
      {/* ── Hero ────────────────────────────────────── */}
      <div className="flex flex-col items-center text-center space-y-3 mt-4">
        <h1 className="text-4xl font-semibold tracking-tight text-foreground font-heading flex items-center justify-center">
          <BrandMark size={40} className="mr-3" />
          <span>Ocul-PM</span>
        </h1>
        <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          오늘 무엇을 만들 건가요?
        </p>
      </div>

      {/* ── Cockpit: cross-project activity (#2) ─────── */}
      {projects.length > 0 && cockpit && cockpit.feed.length > 0 && (
        <section
          className="rounded-2xl border border-border bg-card p-6 sm:p-7 space-y-5"
          aria-label="오늘의 활동"
        >
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-foreground tracking-tight flex items-center gap-2">
              <NotebookText className="w-4 h-4 text-primary" strokeWidth={2} />
              오늘의 활동
            </h2>
            <span className="text-xs text-muted-foreground font-medium">
              오늘 <span className="text-foreground font-bold">{cockpit.todayCount}</span>건 · 전
              프로젝트 {projects.length}
            </span>
          </div>

          <ul className="space-y-0.5">
            {cockpit.feed.map((it, i) => {
              const tone = TYPE_TONE[it.entry.type] ?? TYPE_TONE.chore;
              return (
                <li key={i}>
                  <button
                    onClick={() => {
                      const p = projects.find((x) => x.id === it.projectId);
                      if (p) onSelectProject(p);
                    }}
                    className="group w-full flex items-center gap-3 px-2.5 py-2 rounded-lg hover:bg-accent/40 transition-colors cursor-pointer text-left"
                    aria-label={`${it.projectName} · ${it.entry.title} 열기`}
                  >
                    <span className="text-[11px] font-mono text-muted-foreground/70 w-10 shrink-0">
                      {hhmm(it.entry.created_at)}
                    </span>
                    <span
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ background: tone.color }}
                      title={tone.label}
                    />
                    <span className="text-xs font-semibold text-muted-foreground shrink-0 max-w-[110px] truncate">
                      {it.projectName}
                    </span>
                    <span className="text-sm text-foreground truncate flex-1">
                      {it.entry.title || it.entry.slug}
                    </span>
                    <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100 transition-opacity text-primary shrink-0" />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* ── How it works (PR-R2 C1) — 첫 사용자(프로젝트 0개)에게 핵심 가치
          루프와 *수동 기록이 아니라는* 멘탈 모델을 설명한다. ───────────── */}
      {projects.length === 0 && (
        <section
          className="rounded-2xl border border-border bg-card p-6 sm:p-7 space-y-5"
          aria-label="Ocul-PM 사용 안내"
        >
          <div className="space-y-1.5">
            <h2 className="text-lg font-bold text-foreground tracking-tight">
              Ocul-PM 은 이렇게 동작해요
            </h2>
            <p className="text-sm text-muted-foreground leading-relaxed">
              직접 기록하지 않아도 됩니다. 평소처럼 코딩 에이전트로 작업하면, Ocul-PM 이
              변경·작업 일지·통계를 <span className="text-foreground font-semibold">자동으로</span> 모아줍니다.
            </p>
          </div>

          <ol className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              {
                n: 1,
                Icon: FolderOpen,
                title: "프로젝트 폴더 추가",
                body: "폴더를 불러오면 Ocul-PM 이 코딩 에이전트용 규칙(AGENTS.md)을 자동으로 심어요.",
              },
              {
                n: 2,
                Icon: Bot,
                title: "평소처럼 에이전트로 코딩",
                body: "Claude Code·Cursor·Gemini 등 쓰던 에이전트로 작업하면, 그 규칙에 따라 에이전트가 작업 일지를 남겨요.",
              },
              {
                n: 3,
                Icon: NotebookText,
                title: "자동으로 기록·정리",
                body: "남겨진 작업 일지·변경 diff·통계를 Today 화면에 모아 보여줍니다.",
              },
            ].map(({ n, Icon, title, body }) => (
              <li
                key={n}
                className="rounded-xl border border-border/70 bg-background/40 p-4 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <span className="flex items-center justify-center w-6 h-6 rounded-full bg-primary/12 text-primary text-xs font-bold shrink-0">
                    {n}
                  </span>
                  <Icon className="w-4 h-4 text-primary" strokeWidth={1.75} />
                  <h3 className="text-sm font-bold text-foreground">{title}</h3>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{body}</p>
              </li>
            ))}
          </ol>

          <button
            onClick={() => setAddExpanded(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 transition-colors cursor-pointer"
            aria-label="프로젝트 추가하고 시작하기"
          >
            <Plus className="w-4 h-4" />
            프로젝트 추가하고 시작하기
          </button>
        </section>
      )}

      {/* ── Saved Blueprints ───────────────────────── */}
      {blueprints.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-bold text-muted-foreground flex items-center gap-2">
            <Clock className="w-3.5 h-3.5" />
            임시 저장된 프로젝트
          </h2>
          <div className="flex flex-wrap gap-3">
            {blueprints.map((bp) => (
              <div
                key={bp.id}
                className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-border bg-card/50 text-sm"
              >
                <div className="flex-1 min-w-0">
                  <span className="font-semibold text-foreground truncate">
                    {bp.name || bp.idea_text?.slice(0, 20) || "새 프로젝트"}
                  </span>
                  <span className="text-muted-foreground text-xs ml-2">
                    {stepLabels[bp.wizard_step]}단계 · {relativeTime(bp.updated_at)}
                  </span>
                </div>
                <button
                  onClick={() => {
                    // TODO: Resume wizard from saved step
                    onStartGreenfield();
                  }}
                  className="text-xs font-bold text-primary hover:text-primary/80 transition-colors px-2 py-1 rounded-lg hover:bg-primary/10 cursor-pointer"
                  aria-label={`${bp.name || "프로젝트"} 복원`}
                >
                  복원
                </button>
                <button
                  onClick={() => handleDeleteBlueprint(bp.id)}
                  className="text-xs text-muted-foreground hover:text-destructive transition-colors p-1 rounded-lg hover:bg-destructive/10 cursor-pointer"
                  aria-label={`${bp.name || "프로젝트"} 초안 삭제`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Projects ───────────────────────────────── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-foreground tracking-tight">내 프로젝트</h2>
          <div className="flex items-center space-x-3">
            <span className="text-xs text-muted-foreground font-medium">{projects.length} 전체</span>
            <button
              onClick={onOpenSettings}
              className="p-1.5 rounded-lg border border-border hover:border-primary/45 hover:bg-accent/40 text-muted-foreground hover:text-foreground transition-all duration-200 flex items-center space-x-1.5 text-xs font-semibold cursor-pointer"
              aria-label="설정 열기"
            >
              <Settings className="w-3.5 h-3.5" />
              <span>설정</span>
              <kbd className="text-[9px] text-muted-foreground/70 font-mono ml-1">⌘,</kbd>
            </button>
          </div>
        </div>

        {error && (
          <div className="p-3.5 bg-destructive/10 border border-destructive/20 text-destructive text-xs font-semibold rounded-xl">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
          {displayProjects.map((p) => {
            const s = stats[p.id];
            const isIndexing = indexingId === p.id;
            const lastIso = cockpit?.lastByProject[p.id];
            return (
              <div
                key={p.id}
                onClick={() => onSelectProject(p)}
                className="project-card group bg-card hover:bg-accent/40 border border-border/80 hover:border-primary/40 rounded-2xl p-5 cursor-pointer shadow-sm hover:shadow-lg transition-all duration-200 flex flex-col justify-between min-h-[150px] relative overflow-hidden"
                style={{ transform: "translateY(0)" }}
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <FolderCode className="w-10 h-10 text-primary/80 group-hover:text-primary transition-colors" strokeWidth={1.5} />
                    <div className="flex items-center space-x-1">
                      {isIndexing && (
                        <span className="flex items-center space-x-1 text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-bold mr-2">
                          <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                          <span>인덱싱</span>
                        </span>
                      )}
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex items-center space-x-1" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => onRenameProject(p)}
                          className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
                          aria-label={`${p.name} 이름 변경`}
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => onDeleteProject(p)}
                          className="p-1.5 rounded-lg hover:bg-destructive/15 text-muted-foreground hover:text-destructive transition-colors"
                          aria-label={`${p.name} 제거`}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                  <h3 className="font-bold text-base truncate text-foreground group-hover:text-primary transition-colors">
                    {p.name}
                  </h3>
                  <p className="text-[10px] text-muted-foreground/80 font-mono truncate mt-1">{p.root_path}</p>
                  {lastIso ? (
                    <p className="text-[10px] text-muted-foreground/70 mt-1.5 flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />
                      마지막 활동 {relativeTime(Math.floor(new Date(lastIso).getTime() / 1000))}
                    </p>
                  ) : null}
                </div>

                <div className="flex items-center justify-between mt-4 border-t border-border/40 pt-3">
                  <span className="text-[11px] text-muted-foreground font-semibold">
                    {s ? `${s.files} 파일` : "—"}
                    {cockpit?.todayByProject[p.id] ? (
                      <span className="ml-2 text-primary font-bold">
                        · 오늘 {cockpit.todayByProject[p.id]}
                      </span>
                    ) : null}
                  </span>
                  <span className="text-[10px] text-muted-foreground/60 font-medium flex items-center gap-1">
                    {s ? `${s.chunks} 청크` : ""}
                    <ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity text-primary" />
                  </span>
                </div>
              </div>
            );
          })}

          {addExpanded ? (
            <div
              className="border border-dashed border-primary/50 bg-primary/5 rounded-2xl p-3 flex flex-col min-h-[150px] gap-2 animate-in fade-in zoom-in-95 duration-150"
              role="group"
              aria-label="프로젝트 추가 옵션"
            >
              <button
                onClick={handleChooseExisting}
                className="group flex-1 flex items-center gap-3 px-3 rounded-xl border border-border bg-background hover:border-primary/40 hover:bg-accent/40 transition-all duration-200 cursor-pointer text-left"
                aria-label="기존 폴더 불러오기"
              >
                <FolderOpen className="w-6 h-6 text-muted-foreground group-hover:text-primary transition-colors shrink-0" strokeWidth={1.5} />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-foreground">기존 폴더</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">불러오기</div>
                </div>
              </button>
              <button
                onClick={handleChooseGreenfield}
                className="group flex-1 flex items-center gap-3 px-3 rounded-xl border border-primary/30 bg-background hover:bg-primary/10 hover:border-primary/50 transition-all duration-200 cursor-pointer text-left"
                aria-label="새 프로젝트 시작하기"
              >
                <Sparkles className="w-6 h-6 text-primary group-hover:scale-110 transition-transform shrink-0" strokeWidth={1.5} />
                <div className="min-w-0">
                  <div className="text-xs font-bold text-foreground">새 프로젝트</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">시작하기</div>
                </div>
              </button>
              <button
                onClick={() => setAddExpanded(false)}
                className="text-[10px] font-semibold text-muted-foreground hover:text-foreground transition-colors cursor-pointer self-end px-2 py-0.5"
                aria-label="취소"
              >
                취소
              </button>
            </div>
          ) : (
            <button
              onClick={() => setAddExpanded(true)}
              className="group border border-dashed border-border hover:border-primary/50 hover:bg-primary/5 rounded-2xl p-5 flex flex-col items-center justify-center min-h-[150px] transition-all duration-200 cursor-pointer text-muted-foreground hover:text-primary"
              aria-label="프로젝트 폴더 추가"
            >
              <Plus className="w-8 h-8 mb-2 stroke-[1.5] group-hover:scale-110 transition-transform duration-200" />
              <span className="text-xs font-bold">프로젝트 폴더 추가</span>
            </button>
          )}
        </div>
      </section>
      </div>
    </main>
  );
}
