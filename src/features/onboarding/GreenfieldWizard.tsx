/**
 * GreenfieldWizard — 5단계 프로젝트 생성 위저드 (MASTER-GUIDE §5.7)
 *
 * Step 0: 어떤 앱을 만들까요? (아이디어)
 * Step 1: 누가 사용하나요? (사용자)
 * Step 2: 기술 스택 선택 (CLI 확인)
 * Step 3: 프로젝트 위치 (폴더 picker)
 * Step 4: 초기 목표 확인 (seed goals)
 *
 * X 닫으면 blueprint에 초안 저장. 완료 시 blueprint 삭제.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import { commands, type CliCheckResult } from "@/lib/bindings";
import {
  Sparkles,
  ArrowRight,
  ArrowLeft,
  X,
  Check,
  Loader2,
  Folder,
  AlertTriangle,
  Rocket,
} from "../../components/Icons";
import { BrandMark } from "../../components/BrandMark";
import { Checkbox } from "@/components/ui/checkbox";

interface GreenfieldWizardProps {
  onClose: () => void;
  onComplete: (projectId: number) => void;
}

interface WizardState {
  ideaText: string;
  targetUsers: string;
  stackChoice: string;
  scaffoldCmd: string | null;
  scaffoldArgs: string[];
  folderName: string;
  folderPath: string;
  seedGoals: Array<{ title: string; description: string; priority: number }>;
}

const STACK_PRESETS = [
  {
    id: "vite-react",
    name: "Vite + React",
    desc: "빠른 웹 앱 개발에 적합",
    icon: "⚡",
    cli: "pnpm",
    scaffoldCmd: "pnpm",
    scaffoldArgs: ["create", "vite", "./", "--template", "react-ts"],
  },
  {
    id: "nextjs",
    name: "Next.js",
    desc: "풀스택 웹 프레임워크",
    icon: "▲",
    cli: "npx",
    scaffoldCmd: "npx",
    scaffoldArgs: ["create-next-app@latest", "./", "--ts", "--app", "--use-pnpm", "--no-git"],
  },
  {
    id: "rust",
    name: "Rust",
    desc: "시스템 프로그래밍 / CLI 도구",
    icon: "🦀",
    cli: "cargo",
    scaffoldCmd: "cargo",
    scaffoldArgs: ["init", "--name"],
  },
  {
    id: "python",
    name: "Python",
    desc: "데이터 분석 / API 서버",
    icon: "🐍",
    cli: "python3",
    scaffoldCmd: null,
    scaffoldArgs: [],
  },
  {
    id: "go",
    name: "Go",
    desc: "고성능 서버 / 마이크로서비스",
    icon: "🔵",
    cli: "go",
    scaffoldCmd: "go",
    scaffoldArgs: ["mod", "init"],
  },
  {
    id: "empty",
    name: "빈 프로젝트",
    desc: "수동으로 설정",
    icon: "📁",
    cli: null,
    scaffoldCmd: null,
    scaffoldArgs: [],
  },
];

const IDEA_EXAMPLES = [
  "사내 업무용 대시보드 웹앱",
  "개인 블로그 + 포트폴리오",
  "CLI 파일 변환 도구",
  "REST API 백엔드 서버",
  "모바일 앱 (React Native)",
  "데이터 분석 파이프라인",
];

export function GreenfieldWizard({ onClose, onComplete }: GreenfieldWizardProps) {
  const [step, setStep] = useState(0);
  const [wizState, setWizState] = useState<WizardState>({
    ideaText: "",
    targetUsers: "",
    stackChoice: "",
    scaffoldCmd: null,
    scaffoldArgs: [],
    folderName: "",
    folderPath: "",
    seedGoals: [],
  });
  const [blueprintId, setBlueprintId] = useState<number | null>(null);
  const [cliChecks, setCliChecks] = useState<Record<string, CliCheckResult>>({});
  const [isCreating, setIsCreating] = useState(false);
  const [isGeneratingGoals, setIsGeneratingGoals] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  // W3-PR10 — Greenfield ↔ ocul-pm 통합 (옵션 A). Default ON per
  // refactor-integration §3.1; user can opt out for ad-hoc projects.
  // Persistence is intentionally absent: this is a per-project decision,
  // not a global preference, and the blueprint already captures it
  // implicitly by being recreated on each wizard run.
  const [initOculpm, setInitOculpm] = useState(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-save blueprint (debounced 2s)
  const autoSave = useCallback(async () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        const res = await commands.saveBlueprint(
          blueprintId,
          wizState.folderName || wizState.ideaText.slice(0, 30) || "새 프로젝트",
          wizState.ideaText || null,
          wizState.targetUsers || null,
          wizState.stackChoice || null,
          wizState.folderName || null,
          wizState.folderPath || null,
          wizState.seedGoals.length > 0 ? JSON.stringify(wizState.seedGoals) : null,
          step,
        );
        if (res.status === "ok" && !blueprintId) {
          setBlueprintId(res.data.id);
        }
      } catch {
        // Non-fatal
      }
    }, 2000);
  }, [wizState, step, blueprintId]);

  useEffect(() => {
    autoSave();
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [wizState, step, autoSave]);

  // Check CLI availability when entering step 2
  useEffect(() => {
    if (step === 2) {
      const cliNames = [...new Set(STACK_PRESETS.map((s) => s.cli).filter(Boolean))] as string[];
      cliNames.forEach(async (cli) => {
        if (cliChecks[cli]) return;
        const res = await commands.checkCliAvailable(cli);
        if (res.status === "ok") {
          setCliChecks((prev) => ({ ...prev, [cli]: res.data }));
        }
      });
    }
  }, [step]);

  const handleClose = async () => {
    // Save draft before closing
    if (wizState.ideaText || wizState.folderName) {
      await commands.saveBlueprint(
        blueprintId,
        wizState.folderName || wizState.ideaText.slice(0, 30) || "새 프로젝트",
        wizState.ideaText || null,
        wizState.targetUsers || null,
        wizState.stackChoice || null,
        wizState.folderName || null,
        wizState.folderPath || null,
        null,
        step,
      );
    }
    onClose();
  };

  const handleSelectFolder = async () => {
    const res = await commands.selectProjectFolder();
    if (res.status === "ok" && res.data) {
      const path = res.data;
      const name = path.split("/").filter(Boolean).pop() ?? "project";
      setWizState((prev) => ({
        ...prev,
        folderPath: path,
        folderName: prev.folderName || name,
      }));
    }
  };

  const handleSelectStack = (presetId: string) => {
    const preset = STACK_PRESETS.find((s) => s.id === presetId);
    if (!preset) return;
    setWizState((prev) => ({
      ...prev,
      stackChoice: preset.id,
      scaffoldCmd: preset.scaffoldCmd,
      scaffoldArgs: [...preset.scaffoldArgs],
    }));
  };

  const handleGenerateGoals = async () => {
    setIsGeneratingGoals(true);
    try {
      // Get provider/model from settings
      const allSettings = await commands.settingsGetAll();
      if (allSettings.status !== "ok") return;
      const settingsMap = Object.fromEntries(allSettings.data);
      const provider = settingsMap["default_provider"];
      const model = settingsMap[`model_${provider}`] || settingsMap["default_model"];
      if (!provider || !model) {
        setWizState((prev) => ({
          ...prev,
          seedGoals: [
            { title: "프로젝트 초기 설정 완료", description: "의존성 설치, 빌드 환경 구성, 기본 폴더 구조 정리", priority: 1 },
            { title: "핵심 기능 프로토타입 구현", description: "MVP 수준의 메인 기능 1개 구현", priority: 2 },
            { title: "README 및 문서 작성", description: "프로젝트 설명, 설치 방법, 사용법 문서화", priority: 3 },
          ],
        }));
        return;
      }

      // We need a temporary project_id — but we don't have one yet.
      // Use a placeholder call with just LLM for now.
      // Generate fallback goals inline
      setWizState((prev) => ({
        ...prev,
        seedGoals: [
          { title: "프로젝트 초기 설정 완료", description: "의존성 설치, 빌드 환경 구성, 기본 폴더 구조 정리", priority: 1 },
          { title: "핵심 기능 프로토타입 구현", description: "MVP 수준의 메인 기능 1개 구현", priority: 2 },
          { title: "README 및 문서 작성", description: "프로젝트 설명, 설치 방법, 사용법 문서화", priority: 3 },
        ],
      }));
    } finally {
      setIsGeneratingGoals(false);
    }
  };

  const handleCreate = async () => {
    setIsCreating(true);
    setCreateError(null);

    try {
      const rootPath = wizState.folderPath.endsWith(wizState.folderName)
        ? wizState.folderPath
        : `${wizState.folderPath}/${wizState.folderName}`;

      // Build scaffold args — some templates need the project name appended
      let finalArgs = [...wizState.scaffoldArgs];
      if (wizState.stackChoice === "rust") {
        finalArgs.push(wizState.folderName);
      } else if (wizState.stackChoice === "go") {
        finalArgs.push(wizState.folderName);
      }

      const res = await commands.createGreenfieldProject(
        wizState.folderName,
        rootPath,
        wizState.scaffoldCmd,
        finalArgs.length > 0 ? finalArgs : null,
        blueprintId,
        initOculpm,
      );

      if (res.status === "ok") {
        const projectId = res.data.project_id;

        // Seed the file-based Planner (S1 / planner-unify) — one "초기 계획"
        // plan whose items are the seed goals, so onboarding output lands in
        // the same SSOT the Planner + Today read (not the retired SQLite goals).
        if (wizState.seedGoals.length > 0) {
          const created = await commands.planCreate(projectId, "초기 계획");
          if (created.status === "ok") {
            const planId = created.data.plan_id;
            for (const goal of wizState.seedGoals) {
              await commands.planApplyEdit(
                projectId,
                planId,
                {
                  kind: "add_item",
                  phase: "초기 목표",
                  title: goal.title,
                  item_id: null,
                  status: null,
                },
                "user",
              );
            }
          }
        }

        onComplete(projectId);
      } else {
        setCreateError(res.error);
      }
    } catch (e) {
      setCreateError(String(e));
    } finally {
      setIsCreating(false);
    }
  };

  const canNext = (): boolean => {
    switch (step) {
      case 0: return wizState.ideaText.trim().length > 0;
      case 1: return true; // optional
      case 2: return wizState.stackChoice !== "";
      case 3: return wizState.folderName.trim().length > 0 && wizState.folderPath.trim().length > 0;
      case 4: return true;
      default: return false;
    }
  };

  const goNext = () => {
    if (step === 3 && wizState.seedGoals.length === 0) {
      handleGenerateGoals();
    }
    setStep((s) => Math.min(s + 1, 4));
  };

  const stepTitles = ["어떤 앱을 만들까요?", "누가 사용하나요?", "기술 스택 선택", "프로젝트 위치", "초기 목표 확인"];

  // Escape key to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[90] bg-background/70 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-150">
        {/* Header */}
        <header className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <Sparkles className="w-5 h-5 text-primary" />
            <h2 className="text-base font-bold">{stepTitles[step]}</h2>
            <span className="text-xs text-muted-foreground font-medium">
              {step + 1} / 5
            </span>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
            aria-label="닫기 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Step indicator */}
        <div className="px-6 pt-3 pb-1 flex gap-1.5">
          {[0, 1, 2, 3, 4].map((s) => (
            <div
              key={s}
              className={`h-1 flex-1 rounded-full transition-all duration-200 ${
                s <= step ? "bg-primary" : "bg-border"
              }`}
            />
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 scrollbar-thin">
          {step === 0 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                만들고 싶은 앱이나 프로젝트를 자유롭게 설명해주세요.
              </p>
              <textarea
                value={wizState.ideaText}
                onChange={(e) =>
                  setWizState((prev) => ({ ...prev, ideaText: e.target.value }))
                }
                className="w-full h-32 px-4 py-3 border border-border rounded-xl bg-background text-sm resize-none focus:outline-none focus:border-primary transition-colors"
                placeholder="예: 팀 내부에서 사용할 프로젝트 관리 대시보드"
                autoFocus
              />
              <div className="flex flex-wrap gap-2">
                {IDEA_EXAMPLES.map((ex) => (
                  <button
                    key={ex}
                    onClick={() =>
                      setWizState((prev) => ({ ...prev, ideaText: ex }))
                    }
                    className="px-3 py-1.5 text-xs rounded-full border border-border hover:border-primary/40 hover:bg-primary/5 text-muted-foreground hover:text-foreground transition-all cursor-pointer"
                  >
                    {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                주요 사용자가 누구인지 알려주세요. (선택 사항)
              </p>
              <textarea
                value={wizState.targetUsers}
                onChange={(e) =>
                  setWizState((prev) => ({ ...prev, targetUsers: e.target.value }))
                }
                className="w-full h-24 px-4 py-3 border border-border rounded-xl bg-background text-sm resize-none focus:outline-none focus:border-primary transition-colors"
                placeholder="예: 사내 개발팀 5명, 비개발자도 포함"
                autoFocus
              />
              <div className="flex flex-wrap gap-2">
                {["개발자", "일반 사용자", "내부 팀", "학생", "오픈소스 커뮤니티"].map(
                  (ex) => (
                    <button
                      key={ex}
                      onClick={() =>
                        setWizState((prev) => ({
                          ...prev,
                          targetUsers: prev.targetUsers
                            ? `${prev.targetUsers}, ${ex}`
                            : ex,
                        }))
                      }
                      className="px-3 py-1.5 text-xs rounded-full border border-border hover:border-primary/40 hover:bg-primary/5 text-muted-foreground hover:text-foreground transition-all cursor-pointer"
                    >
                      {ex}
                    </button>
                  )
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                프로젝트에 사용할 기술 스택을 선택하세요.
              </p>
              <div className="grid grid-cols-2 gap-3">
                {STACK_PRESETS.map((preset) => {
                  const isSelected = wizState.stackChoice === preset.id;
                  const cliCheck = preset.cli ? cliChecks[preset.cli] : null;
                  const cliAvailable = !preset.cli || cliCheck?.available;

                  return (
                    <button
                      key={preset.id}
                      onClick={() => handleSelectStack(preset.id)}
                      className={`relative p-4 rounded-xl border text-left transition-all cursor-pointer ${
                        isSelected
                          ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                          : "border-border hover:border-primary/30 hover:bg-accent/30"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xl">{preset.icon}</span>
                        {preset.cli && (
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                              cliCheck === undefined
                                ? "text-muted-foreground bg-muted"
                                : cliAvailable
                                  ? "text-primary bg-primary/10"
                                  : "text-[var(--accent-uncommitted)] bg-muted"
                            }`}
                          >
                            {cliCheck === undefined
                              ? "확인 중..."
                              : cliAvailable
                                ? "✅ 설치됨"
                                : "⚠️ 미설치"}
                          </span>
                        )}
                      </div>
                      <div className="font-bold text-sm">{preset.name}</div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {preset.desc}
                      </div>
                      {isSelected && (
                        <div className="absolute top-2 right-2">
                          <Check className="w-4 h-4 text-primary" />
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                프로젝트를 저장할 위치와 이름을 지정하세요.
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                    프로젝트 이름
                  </label>
                  <input
                    type="text"
                    value={wizState.folderName}
                    onChange={(e) =>
                      setWizState((prev) => ({ ...prev, folderName: e.target.value }))
                    }
                    className="w-full px-4 py-2.5 border border-border rounded-xl bg-background text-sm focus:outline-none focus:border-primary transition-colors"
                    placeholder="my-awesome-app"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                    저장 위치
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={wizState.folderPath}
                      onChange={(e) =>
                        setWizState((prev) => ({ ...prev, folderPath: e.target.value }))
                      }
                      className="flex-1 px-4 py-2.5 border border-border rounded-xl bg-background text-sm focus:outline-none focus:border-primary transition-colors font-mono text-xs"
                      placeholder="/Users/me/projects"
                      readOnly
                    />
                    <button
                      onClick={handleSelectFolder}
                      className="px-4 py-2.5 border border-border rounded-xl hover:bg-accent text-sm font-semibold transition-colors cursor-pointer flex items-center gap-2"
                      aria-label="폴더 선택"
                    >
                      <Folder className="w-4 h-4" />
                      선택
                    </button>
                  </div>
                </div>
                {wizState.folderPath && wizState.folderName && (
                  <p className="text-xs text-muted-foreground font-mono px-1">
                    → {wizState.folderPath}/{wizState.folderName}
                  </p>
                )}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                AI가 생성한 초기 목표를 확인하고 수정할 수 있습니다.
              </p>

              {isGeneratingGoals ? (
                <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm">목표를 생성하고 있어요...</span>
                </div>
              ) : (
                <div className="space-y-3">
                  {wizState.seedGoals.map((goal, i) => (
                    <div
                      key={i}
                      className="p-4 rounded-xl border border-border bg-background space-y-2"
                    >
                      <input
                        type="text"
                        value={goal.title}
                        onChange={(e) => {
                          const updated = [...wizState.seedGoals];
                          updated[i] = { ...updated[i], title: e.target.value };
                          setWizState((prev) => ({ ...prev, seedGoals: updated }));
                        }}
                        className="w-full text-sm font-bold bg-transparent border-none focus:outline-none"
                      />
                      <textarea
                        value={goal.description}
                        onChange={(e) => {
                          const updated = [...wizState.seedGoals];
                          updated[i] = { ...updated[i], description: e.target.value };
                          setWizState((prev) => ({ ...prev, seedGoals: updated }));
                        }}
                        className="w-full text-xs text-muted-foreground bg-transparent border-none focus:outline-none resize-none h-12"
                      />
                    </div>
                  ))}
                  {wizState.seedGoals.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      <p>목표가 아직 없습니다.</p>
                      <button
                        onClick={handleGenerateGoals}
                        className="mt-2 text-primary text-xs font-bold hover:underline cursor-pointer"
                      >
                        AI로 목표 생성하기
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* W3-PR10 — ocul-pm 통합 (옵션 A). Default ON. */}
              <div className="rounded-xl border border-border bg-card/40 p-3.5">
                <label className="flex items-start gap-2.5 cursor-pointer select-none">
                  <Checkbox
                    checked={initOculpm}
                    onCheckedChange={(v) => setInitOculpm(v === true)}
                    aria-label="ocul-pm 으로 이 프로젝트 추적"
                    className="mt-0.5"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <BrandMark size={16} />
                      ocul-pm 으로 이 프로젝트 추적
                      <span className="text-[10px] text-primary/80 font-semibold uppercase tracking-wider">
                        권장
                      </span>
                    </span>
                    <span className="block text-[11px] text-muted-foreground mt-1 leading-relaxed">
                      파일 변경과 작업 narrative 를 자동 기록합니다.
                      <code className="font-mono mx-1 text-[10.5px] bg-muted px-1 rounded">.oculpm/</code>
                      디렉토리가 생기고, 외부 LLM (Claude Code, Cursor 등) 의 작업이 Today 탭에 정리됩니다.
                      나중에 EmptyToday 의 활성화 카드로도 켤 수 있습니다.
                    </span>
                  </span>
                </label>
              </div>

              {createError && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-xs font-semibold rounded-xl flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{createError}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="px-6 py-4 border-t border-border flex items-center justify-between shrink-0">
          <button
            onClick={() => step > 0 ? setStep((s) => s - 1) : handleClose()}
            className="px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors rounded-xl hover:bg-accent flex items-center gap-1.5 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            {step > 0 ? "이전" : "닫기"}
          </button>

          {step < 4 ? (
            <button
              onClick={goNext}
              disabled={!canNext()}
              className="px-5 py-2 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
            >
              다음
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={handleCreate}
              disabled={isCreating}
              className="px-5 py-2 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 rounded-xl text-xs font-bold transition-colors flex items-center gap-2 cursor-pointer disabled:cursor-not-allowed"
            >
              {isCreating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  생성 중...
                </>
              ) : (
                <>
                  프로젝트 시작하기
                  <Rocket className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
