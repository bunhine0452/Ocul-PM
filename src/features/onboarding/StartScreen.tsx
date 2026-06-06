/**
 * StartScreen — 프로젝트 미선택 상태의 진입 화면 (MASTER-GUIDE §5.7)
 *
 * 기존 Dashboard 컴포넌트를 대체. 두 가지 진입 경로를 제공:
 *  - 📂 기존 폴더 불러오기 (folder picker)
 *  - ✨ 새 프로젝트 시작하기 (Greenfield Wizard)
 *
 * 추가로 미완성 blueprint 복원/삭제 UI와 최근 프로젝트 카드를 표시.
 */
import { useEffect, useState } from "react";
import { commands, type Project, type ProjectStats, type ProjectBlueprint } from "@/lib/bindings";
import {
  FolderCode,
  FolderOpen,
  RefreshCw,
  Pencil,
  Trash2,
  OculIcon,
  Sparkles,
  Plus,
  Settings,
  Clock,
  ArrowRight,
  Bot,
  NotebookText,
} from "../../components/Icons";

type StatsMap = Record<number, ProjectStats>;

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

  useEffect(() => {
    loadBlueprints();
  }, []);

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

  return (
    <main className="flex-1 overflow-y-auto p-8 max-w-5xl mx-auto w-full space-y-10 scrollbar-thin">
      {/* ── Hero ────────────────────────────────────── */}
      <div className="flex flex-col items-center text-center space-y-3 mt-4">
        <h1 className="text-4xl font-semibold tracking-tight text-foreground font-heading flex items-center justify-center">
          <OculIcon className="w-9 h-9 text-primary mr-3" strokeWidth={1.5} />
          <span>Ocul-PM</span>
        </h1>
        <p className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          오늘 무엇을 만들 건가요?
        </p>
      </div>

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
          {projects.map((p) => {
            const s = stats[p.id];
            const isIndexing = indexingId === p.id;
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
                </div>

                <div className="flex items-center justify-between mt-4 border-t border-border/40 pt-3">
                  <span className="text-[11px] text-muted-foreground font-semibold">
                    {s ? `${s.files} 파일` : "—"}
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
    </main>
  );
}
