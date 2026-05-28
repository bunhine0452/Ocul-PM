import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Loader2,
  Sparkles,
  Copy,
  Check,
  X,
} from "@/components/Icons";
import { Markdown } from "@/components/Markdown";
import {
  commands,
  type ClarifyQuestion,
  type ClarifyAnswer,
  type EditPromptResult,
} from "@/lib/bindings";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { useSettings } from "@/contexts/SettingsContext";
import { ChatPanel } from "@/features/chat/ChatPanel";
import { ClarifyDialog } from "./ClarifyDialog";
import { ModelSelector } from "@/components/ModelSelector";
import { providerModel, type Provider } from "@/lib/settings";

// MASTER-GUIDE §5.6 — Code 워크벤치의 오른쪽 패널.
// Chat과 QuickEdit이 통합된 단일 AI 패널.
// 상단: Chat / QuickEdit 모드 토글 + Cursor 스타일 ModelSelector
// 하단: 모드에 따라 전환

interface AiWorkbenchProps {
  activeProjectId: number | null;
  activeFile: string | null;
}

export function AiWorkbench({ activeProjectId, activeFile }: AiWorkbenchProps) {
  const { state, setState } = useWorkspace();
  const { settings } = useSettings();
  const mode = state.aiWorkbenchMode;

  // Shared provider/model state — used by both Chat and QuickEdit.
  const [provider, setProvider] = useState<Provider>(settings.defaultProvider);
  const [model, setModel] = useState("");

  // Load saved default model on mount.
  useEffect(() => {
    (async () => {
      const saved = await commands.settingsGet("default_model");
      if (saved.status === "ok" && saved.data) setModel(saved.data);
    })();
  }, []);

  function setMode(m: "quick-edit" | "chat") {
    setState((prev) => ({ ...prev, aiWorkbenchMode: m }));
  }

  const effectiveModel = model || providerModel(settings, provider);

  return (
    <div className="h-full flex flex-col overflow-hidden border-l border-border">
      {/* Row 1: Mode toggle + shortcut hint */}
      <header className="border-b border-border bg-secondary/20 flex flex-col shrink-0">
        <div className="h-10 flex items-center px-3">
          <div className="flex items-center gap-1 bg-secondary/40 rounded-md p-0.5">
            <ModeButton
              active={mode === "chat"}
              onClick={() => setMode("chat")}
              label="Chat"
            />
            <ModeButton
              active={mode === "quick-edit"}
              onClick={() => setMode("quick-edit")}
              label="Quick Edit"
            />
          </div>
          <kbd className="ml-auto text-[10px] text-muted-foreground/70 font-mono">⌘\</kbd>
        </div>

        {/* Row 2: ModelSelector */}
        <div className="h-9 flex items-center px-3 border-t border-border/50 bg-secondary/10">
          <ModelSelector
            provider={provider}
            model={model}
            onProviderChange={setProvider}
            onModelChange={setModel}
            placeholder={providerModel(settings, provider)}
          />
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-hidden">
        {mode === "quick-edit" ? (
          <QuickEdit
            activeProjectId={activeProjectId}
            provider={provider}
            model={effectiveModel}
          />
        ) : (
          <ChatPanel
            isWorkspaceMode
            compactSidebar
            activeProjectId={activeProjectId}
            activeFile={activeFile}
            externalProvider={provider}
            externalModel={model}
          />
        )}
      </div>
    </div>
  );
}

function ModeButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 text-[11px] font-bold rounded transition-colors cursor-pointer ${
        active ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

// ───────────────────────────────────────────────────────────────────────
// Quick Edit mode
// ───────────────────────────────────────────────────────────────────────

function QuickEdit({
  activeProjectId,
  provider,
  model,
}: {
  activeProjectId: number | null;
  provider: Provider;
  model: string;
}) {
  // Inputs
  const [userRequest, setUserRequest] = useState("");

  // Pipeline state
  const [phase, setPhase] = useState<"idle" | "clarifying" | "generating">("idle");
  const [error, setError] = useState<string | null>(null);

  // Clarify dialog state
  const [clarifyOpen, setClarifyOpen] = useState(false);
  const [questions, setQuestions] = useState<ClarifyQuestion[]>([]);
  const [ambiguity, setAmbiguity] = useState(0);

  // Result
  const [result, setResult] = useState<EditPromptResult | null>(null);
  const [copied, setCopied] = useState(false);

  // Clear stale prompt result when the active project changes.
  useEffect(() => {
    setResult(null);
  }, [activeProjectId]);

  async function startGeneration() {
    if (!userRequest.trim() || activeProjectId == null) return;
    setError(null);
    setResult(null);
    setPhase("clarifying");
    const effectiveModel = model;

    // ① Ambiguity check
    const c = await commands.clarifyEditIntent(
      activeProjectId,
      userRequest,
      provider,
      effectiveModel,
    );
    if (c.status !== "ok") {
      setError((c as any).error ?? "명확화 단계 실패");
      setPhase("idle");
      return;
    }

    if (c.data.auto_proceed || c.data.questions.length === 0) {
      // Skip dialog — go straight to generation with no answers.
      await runGeneration([]);
      return;
    }

    // Specta exports f32 as `number | null` defensively; coerce to 0 when
    // the LLM omits it so the dialog header still renders something.
    setAmbiguity(c.data.ambiguity_score ?? 0);
    setQuestions(c.data.questions);
    setClarifyOpen(true);
    setPhase("idle"); // Resume "generating" when user submits the dialog.
  }

  async function runGeneration(answers: ClarifyAnswer[]) {
    if (activeProjectId == null) return;
    setPhase("generating");
    setError(null);
    const effectiveModel = model;
    const res = await commands.generateEditPromptWithAnswers(
      activeProjectId,
      userRequest,
      answers,
      provider,
      effectiveModel,
    );
    if (res.status === "ok") {
      setResult(res.data);
      setClarifyOpen(false);
    } else {
      setError((res as any).error ?? "프롬프트 생성 실패");
    }
    setPhase("idle");
  }

  async function handleCopy() {
    if (!result) return;
    await navigator.clipboard.writeText(result.english_prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (activeProjectId == null) {
    return (
      <div className="h-full flex items-center justify-center p-6 text-xs text-muted-foreground text-center">
        프로젝트를 선택한 뒤 사용해주세요.
      </div>
    );
  }

  return (
    <>
      <div className="h-full flex flex-col overflow-hidden">

        <div className="flex-1 overflow-y-auto scrollbar-thin p-4 space-y-4">
          {/* Input */}
          <section className="space-y-2">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">
              수정 의도
            </label>
            <Textarea
              value={userRequest}
              onChange={(e) => setUserRequest(e.target.value)}
              placeholder='예) "로그인 페이지에 소셜 로그인 버튼 추가"'
              className="min-h-[100px] text-sm"
              disabled={phase !== "idle"}
            />
            <Button
              onClick={startGeneration}
              disabled={phase !== "idle" || !userRequest.trim()}
              className="w-full h-9"
            >
              {phase === "clarifying" ? (
                <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> 모호도 분석…</>
              ) : phase === "generating" ? (
                <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> 프롬프트 생성…</>
              ) : (
                <><Sparkles className="w-3.5 h-3.5 mr-1.5" /> 영어 프롬프트 생성</>
              )}
            </Button>
          </section>

          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive rounded-xl text-xs flex items-start gap-2">
              <span className="flex-1">{error}</span>
              <button onClick={() => setError(null)} className="hover:text-foreground">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* Result */}
          {result && (
            <section className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-[11px] uppercase tracking-wider text-muted-foreground font-bold">
                  영어 프롬프트
                </label>
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  {copied ? <Check className="w-3 h-3 mr-1.5" /> : <Copy className="w-3 h-3 mr-1.5" />}
                  {copied ? "복사됨" : "복사"}
                </Button>
              </div>
              <pre className="p-3 rounded-lg border border-border bg-card text-[11px] whitespace-pre-wrap font-mono leading-relaxed max-h-72 overflow-y-auto scrollbar-thin">
                {result.english_prompt}
              </pre>

              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
                  한국어 요약 보기
                </summary>
                <div className="mt-2 p-3 rounded-lg border border-border bg-secondary/30">
                  <Markdown>{result.korean_summary}</Markdown>
                </div>
              </details>

              {result.related_files.length > 0 && (
                <div className="text-[11px] text-muted-foreground">
                  관련 파일: {result.related_files.map((f) => (
                    <code key={f} className="font-mono mx-1">{f}</code>
                  ))}
                </div>
              )}
            </section>
          )}

        </div>
      </div>

      <ClarifyDialog
        open={clarifyOpen}
        ambiguityScore={ambiguity}
        questions={questions}
        busy={phase === "generating"}
        onCancel={() => setClarifyOpen(false)}
        onSubmit={(answers) => runGeneration(answers)}
      />
    </>
  );
}
