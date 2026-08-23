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
import { commands, type CliCheckResult, type ProjectBlueprint } from "@/lib/bindings";
import { setPendingDispatch } from "@/features/terminal/dispatchBus";
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
// t() = 화면 문구, tc() = 디스크·에이전트로 나가는 산출물 (작성 언어 축).
import { tc, useT, type I18nKey } from "@/i18n";

interface GreenfieldWizardProps {
  onClose: () => void;
  onComplete: (projectId: number) => void;
  /** 대시보드 "복원" — 저장된 초안에서 단계·입력을 이어서 시작한다 (감사 fix). */
  resume?: ProjectBlueprint | null;
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

/**
 * 스택 프리셋. `name` 은 제품명(Vite + React · Rust …)이라 **번역하지 않는다** —
 * 번역 대상은 설명(`descKey`)과, 제품명이 아닌 "빈 프로젝트"(`nameKey`)뿐이다.
 */
const STACK_PRESETS: Array<{
  id: string;
  name?: string;
  nameKey?: I18nKey;
  descKey: I18nKey;
  icon: string;
  cli: string | null;
  scaffoldCmd: string | null;
  scaffoldArgs: string[];
}> = [
  {
    id: "vite-react",
    name: "Vite + React",
    descKey: "gf.stackNextDesc",
    icon: "⚡",
    cli: "pnpm",
    scaffoldCmd: "pnpm",
    scaffoldArgs: ["create", "vite", "./", "--template", "react-ts"],
  },
  {
    id: "nextjs",
    name: "Next.js",
    descKey: "gf.stackFullstackDesc",
    icon: "▲",
    cli: "npx",
    scaffoldCmd: "npx",
    scaffoldArgs: ["create-next-app@latest", "./", "--ts", "--app", "--use-pnpm", "--no-git"],
  },
  {
    id: "rust",
    name: "Rust",
    descKey: "gf.stackRustDesc",
    icon: "🦀",
    cli: "cargo",
    scaffoldCmd: "cargo",
    scaffoldArgs: ["init", "--name"],
  },
  {
    id: "python",
    name: "Python",
    descKey: "gf.stackPythonDesc",
    icon: "🐍",
    cli: "python3",
    scaffoldCmd: null,
    scaffoldArgs: [],
  },
  {
    id: "go",
    name: "Go",
    descKey: "gf.stackGoDesc",
    icon: "🔵",
    cli: "go",
    scaffoldCmd: "go",
    scaffoldArgs: ["mod", "init"],
  },
  {
    id: "empty",
    nameKey: "gf.stackEmptyName",
    descKey: "gf.stackEmptyDesc",
    icon: "📁",
    cli: null,
    scaffoldCmd: null,
    scaffoldArgs: [],
  },
];

/** 예시 아이디어 — 키 배열이다 (모듈 상수 문자열이면 언어가 임포트 시점에 굳는다). */
const IDEA_EXAMPLE_KEYS = [
  "gf.idea1",
  "gf.idea2",
  "gf.idea3",
  "gf.idea4",
  "gf.idea5",
  "gf.idea6",
] as const;

/** seed_goals_json 관대 파싱 — 초안이 깨져 있어도 마법사는 열려야 한다. */
function parseSeedGoals(json: string | null): WizardState["seedGoals"] {
  if (!json) return [];
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function GreenfieldWizard({ onClose, onComplete, resume = null }: GreenfieldWizardProps) {
  const { t } = useT();
  // 복원(감사 fix): 저장된 초안이 오면 단계·입력·blueprint id 를 그대로 이어서
  // 시작한다 — 이전에는 "복원"이 항상 0단계 새 초안을 만들어 중복이 쌓였다.
  const resumePreset = resume?.stack_choice
    ? STACK_PRESETS.find((s) => s.id === resume.stack_choice)
    : null;
  const [step, setStep] = useState(() =>
    resume ? Math.min(Math.max(resume.wizard_step, 0), 4) : 0,
  );
  const [wizState, setWizState] = useState<WizardState>(() =>
    resume
      ? {
          ideaText: resume.idea_text ?? "",
          targetUsers: resume.target_users ?? "",
          stackChoice: resume.stack_choice ?? "",
          scaffoldCmd: resumePreset?.scaffoldCmd ?? null,
          scaffoldArgs: resumePreset ? [...resumePreset.scaffoldArgs] : [],
          folderName: resume.folder_name ?? "",
          folderPath: resume.folder_path ?? "",
          seedGoals: parseSeedGoals(resume.seed_goals_json),
        }
      : {
          ideaText: "",
          targetUsers: "",
          stackChoice: "",
          scaffoldCmd: null,
          scaffoldArgs: [],
          folderName: "",
          folderPath: "",
          seedGoals: [],
        },
  );
  const [blueprintId, setBlueprintId] = useState<number | null>(resume?.id ?? null);
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
          wizState.folderName || wizState.ideaText.slice(0, 30) || tc("gf.defaultName"),
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
        wizState.folderName || wizState.ideaText.slice(0, 30) || tc("gf.defaultName"),
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
            { title: tc("content.seed1Title"), description: tc("content.seed1Desc"), priority: 1 },
            { title: tc("content.seed2Title"), description: tc("content.seed2Desc"), priority: 2 },
            { title: tc("content.seed3Title"), description: tc("content.seed3Desc"), priority: 3 },
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
          { title: tc("content.seed1Title"), description: tc("content.seed1Desc"), priority: 1 },
          { title: tc("content.seed2Title"), description: tc("content.seed2Desc"), priority: 2 },
          { title: tc("content.seed3Title"), description: tc("content.seed3Desc"), priority: 3 },
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

        // IN1 — 인셉션 킥오프 예약: 새 프로젝트에서 터미널을 열면
        // project-inception 스킬 발화 프롬프트가 프리필돼 있다 (실행은 Enter).
        {
          const idea = wizState.ideaText.trim().replace(/\s+/g, " ").slice(0, 300);
          const who = wizState.targetUsers.trim().replace(/\s+/g, " ").slice(0, 150);
          // 터미널에 프리필돼 **사용자가 읽고 실행**하는 프롬프트라 §4.5 의
          // 예외에 해당한다 — 본문도 번역하되, 응답 언어가 산출물 언어와
          // 같아야 하므로 t() 가 아니라 tc() 다.
          const kickoff =
            tc("gf.kickoffLead") +
            tc("gf.kickoffIdea", { idea }) +
            (who ? tc("gf.kickoffWho", { who }) : "");
          setPendingDispatch({
            command: `claude "${kickoff.replace(/["\\$]/g, "\\$&")}"`,
            prompt: kickoff,
          });
        }

        // Seed the file-based Planner (S1 / planner-unify) — one "초기 계획"
        // plan whose items are the seed goals, so onboarding output lands in
        // the same SSOT the Planner + Today read (not the retired SQLite goals).
        if (wizState.seedGoals.length > 0) {
          const created = await commands.planCreate(projectId, tc("content.initialPlan"));
          if (created.status === "ok") {
            const planId = created.data.plan_id;
            for (const goal of wizState.seedGoals) {
              await commands.planApplyEdit(
                projectId,
                planId,
                {
                  kind: "add_item",
                  phase: tc("content.initialGoalsPhase"),
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

  const stepTitles = [t("gf.step1"), t("gf.step2"), t("gf.step3"), t("gf.step4"), t("gf.step5")];

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
      data-home-overlay
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
            aria-label={t("gf.close")}
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
                {t("gf.ideaPrompt")}
              </p>
              <textarea
                value={wizState.ideaText}
                onChange={(e) =>
                  setWizState((prev) => ({ ...prev, ideaText: e.target.value }))
                }
                className="w-full h-32 px-4 py-3 border border-border rounded-xl bg-background text-sm resize-none focus:outline-none focus:border-primary transition-colors"
                placeholder={t("gf.ideaPlaceholder")}
                autoFocus
              />
              <div className="flex flex-wrap gap-2">
                {IDEA_EXAMPLE_KEYS.map((key) => (
                  <button
                    key={key}
                    onClick={() =>
                      setWizState((prev) => ({ ...prev, ideaText: t(key) }))
                    }
                    className="px-3 py-1.5 text-xs rounded-full border border-border hover:border-primary/40 hover:bg-primary/5 text-muted-foreground hover:text-foreground transition-all cursor-pointer"
                  >
                    {t(key)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("gf.usersPrompt")}
              </p>
              <textarea
                value={wizState.targetUsers}
                onChange={(e) =>
                  setWizState((prev) => ({ ...prev, targetUsers: e.target.value }))
                }
                className="w-full h-24 px-4 py-3 border border-border rounded-xl bg-background text-sm resize-none focus:outline-none focus:border-primary transition-colors"
                placeholder={t("gf.usersPlaceholder")}
                autoFocus
              />
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    "gf.userDev",
                    "gf.userGeneral",
                    "gf.userInternal",
                    "gf.userStudent",
                    "gf.userOss",
                  ] as const
                ).map((key) => {
                  const ex = t(key);
                  return (
                    <button
                      key={key}
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
                  );
                })}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {t("gf.stackPrompt")}
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
                              ? t("gf.checking")
                              : cliAvailable
                                ? t("gf.installed")
                                : t("gf.notInstalled")}
                          </span>
                        )}
                      </div>
                      <div className="font-bold text-sm">
                        {preset.nameKey ? t(preset.nameKey) : preset.name}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {t(preset.descKey)}
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
                {t("gf.locationPrompt")}
              </p>
              <div className="space-y-3">
                <div>
                  <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                    {t("gf.projectName")}
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
                    {t("gf.saveLocation")}
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
                      aria-label={t("gf.pickFolder")}
                    >
                      <Folder className="w-4 h-4" />
                      {t("gf.pick")}
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
                {t("gf.goalsPrompt")}
              </p>

              {isGeneratingGoals ? (
                <div className="flex items-center justify-center py-10 gap-2 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm">{t("gf.generatingGoals")}</span>
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
                      <p>{t("gf.noGoals")}</p>
                      <button
                        onClick={handleGenerateGoals}
                        className="mt-2 text-primary text-xs font-bold hover:underline cursor-pointer"
                      >
                        {t("gf.generateGoals")}
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
                    aria-label={t("gf.trackAria")}
                    className="mt-0.5"
                  />
                  <span className="flex-1 min-w-0">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <BrandMark size={16} />
                      {t("gf.trackLabel")}
                      <span className="text-[10px] text-primary/80 font-semibold uppercase tracking-wider">
                        {t("gf.recommended")}
                      </span>
                    </span>
                    <span className="block text-[11px] text-muted-foreground mt-1 leading-relaxed">
                      {t("gf.trackHint1")}
                      <code className="font-mono mx-1 text-[10.5px] bg-muted px-1 rounded">.oculpm/</code>
                      {t("gf.trackHint2Suffix")}
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
            {step > 0 ? t("gf.prev") : t("common.close")}
          </button>

          {step < 4 ? (
            <button
              onClick={goNext}
              disabled={!canNext()}
              className="px-5 py-2 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer disabled:cursor-not-allowed"
            >
              {t("gf.next")}
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
                  {t("gf.creating")}
                </>
              ) : (
                <>
                  {t("gf.start")}
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
