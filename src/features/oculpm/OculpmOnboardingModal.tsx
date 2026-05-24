/**
 * OculpmOnboardingModal — 3-step modal that activates `.oculpm/` for a
 * project.
 *
 * Steps:
 *  1. Intro — what ocul-pm does, with a small manual-vs-auto comparison.
 *  2. Agents — toggle the 4 known agent adapters (sync wires in W4).
 *  3. Summary — list what files will be created / written, require explicit
 *     consent checkbox, then run `oculpmApi.init` + `oculpmApi.setConfig`.
 *
 * Mount-time guard: if `getStatus` already reports `initialized` (e.g. the
 * Greenfield wizard's "옵션 A" already ran init), close immediately with
 * `reason: "already_initialized"`. This prevents the double-onboarding
 * UX described in `refactor-integration.md` §3.1.
 *
 * Dismiss persistence: when the user picks "나중에" (Step 1) we write
 * `localStorage["oculpm_dismissed_${projectId}"] = "1"` so the modal
 * doesn't re-appear on next project select. The status-bar "활성화" link
 * (rendered by TodayScreen) is the re-entry point.
 */

import { useEffect, useState } from "react";
import { oculpmApi, OculpmApiError } from "@/api/oculpm";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Sparkles,
  X,
  OculIcon,
  MessageCircle,
} from "@/components/Icons";

interface OculpmOnboardingModalProps {
  projectId: number;
  onClose: (reason?: OnboardingCloseReason) => void;
}

export type OnboardingCloseReason =
  | "dismissed"
  | "completed"
  | "already_initialized";

type Step = 0 | 1 | 2;

/** Known agent ids (kept in lock-step with backend `config::KNOWN_AGENT_IDS`). */
const KNOWN_AGENTS: ReadonlyArray<{
  id: string;
  label: string;
  description: string;
  adapterPath: string;
}> = [
  {
    id: "claude-code",
    label: "Claude Code",
    description: "Anthropic CLI 에이전트",
    adapterPath: ".claude/CLAUDE.md (managed block)",
  },
  {
    id: "cursor",
    label: "Cursor",
    description: "VS Code 기반 AI 에디터",
    adapterPath: ".cursor/rules/ocul-pm.mdc",
  },
  {
    id: "antigravity",
    label: "Antigravity",
    description: "에이전트 프레임워크",
    adapterPath: ".agent/rules/ocul-pm.md",
  },
  {
    id: "gemini-cli",
    label: "Gemini CLI",
    description: "Google 에이전트",
    adapterPath: "GEMINI.md (managed block)",
  },
];

const STEP_TITLES: Record<Step, string> = {
  0: "ocul-pm 으로 추적 시작",
  1: "활성 에이전트 선택",
  2: "변경 사항 확인",
};

export function OculpmOnboardingModal({
  projectId,
  onClose,
}: OculpmOnboardingModalProps) {
  const { setOculpmStatus } = useWorkspace();
  const [step, setStep] = useState<Step>(0);
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [agreed, setAgreed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ── Mount-time guard: skip the modal if `.oculpm/` is already initialised
  //    (e.g. Greenfield 옵션 A already ran init). Avoids the double-onboarding
  //    described in refactor-integration §3.1.
  useEffect(() => {
    let cancelled = false;
    void oculpmApi
      .getStatus(projectId)
      .then((status) => {
        if (cancelled) return;
        if (status.initialized) {
          setOculpmStatus(status);
          onClose("already_initialized");
        }
      })
      .catch(() => {
        // Status fetch failure is non-fatal — let the user proceed with the
        // modal manually. The activation step will surface any real error.
      });
    return () => {
      cancelled = true;
    };
    // Intentional: only re-run if the project itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // ── Esc to close ───────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose("dismissed");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, submitting]);

  const toggleAgent = (id: string) => {
    setSelectedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDismiss = () => {
    try {
      localStorage.setItem(`oculpm_dismissed_${projectId}`, "1");
    } catch {
      /* QuotaExceeded / private mode — non-fatal */
    }
    onClose("dismissed");
  };

  const handleActivate = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await oculpmApi.init(projectId);
      // Read current config, mutate active agents, write back.
      const config = await oculpmApi.getConfig(projectId);
      await oculpmApi.setConfig(projectId, {
        ...config,
        agents: { ...config.agents, active: Array.from(selectedAgents) },
      });
      const status = await oculpmApi.getStatus(projectId);
      setOculpmStatus(status);
      // Clear any prior dismiss flag — user actively opted in.
      try {
        localStorage.removeItem(`oculpm_dismissed_${projectId}`);
      } catch {
        /* non-fatal */
      }
      onClose("completed");
    } catch (e) {
      const msg =
        e instanceof OculpmApiError
          ? `${e.command} 실패: ${e.message}`
          : e instanceof Error
            ? e.message
            : String(e);
      setError(msg);
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] bg-background/70 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose("dismissed");
      }}
    >
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col animate-in zoom-in-95 duration-150">
        {/* Header */}
        <header className="px-6 py-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <OculIcon className="w-5 h-5 text-primary" />
            <h2 className="text-base font-bold">{STEP_TITLES[step]}</h2>
            <span className="text-xs text-muted-foreground font-medium">
              {step + 1} / 3
            </span>
          </div>
          <button
            onClick={() => !submitting && onClose("dismissed")}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-50"
            aria-label="닫기 (Esc)"
            disabled={submitting}
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        {/* Step indicator */}
        <div className="px-6 pt-3 pb-1 flex gap-1.5">
          {[0, 1, 2].map((s) => (
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
          {step === 0 && <Step1Intro />}
          {step === 1 && (
            <Step2Agents
              selected={selectedAgents}
              onToggle={toggleAgent}
            />
          )}
          {step === 2 && (
            <Step3Summary
              selectedAgents={selectedAgents}
              agreed={agreed}
              onAgreedChange={setAgreed}
              error={error}
            />
          )}
        </div>

        {/* Footer — actions */}
        <footer className="px-6 py-4 border-t border-border flex items-center justify-between shrink-0 gap-3">
          {step === 0 ? (
            <Button variant="ghost" onClick={handleDismiss} disabled={submitting}>
              나중에
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => setStep(((step - 1) as Step))}
              disabled={submitting}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              이전
            </Button>
          )}

          {step < 2 ? (
            <Button onClick={() => setStep(((step + 1) as Step))}>
              다음
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          ) : (
            <Button onClick={handleActivate} disabled={!agreed || submitting}>
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  활성화 중…
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  활성화
                </>
              )}
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}

// ─── Step 1: intro ───────────────────────────────────────────────────────

function Step1Intro() {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground leading-relaxed">
        ocul-pm 이 이 프로젝트의 작업을 자동 기록할 수 있어요. 코드 변경은
        파일 워처가 잡아두고, 작업 narrative 는 외부 LLM 이 markdown 으로
        남기면 Today 탭에서 시간순으로 보이는 흐름이 됩니다.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <ComparePanel
          title="수동 changelog"
          tone="dim"
          items={[
            "변경을 매번 수동으로 적어야 함",
            "외부 LLM 작업은 누락되기 쉬움",
            "narrative ↔ 실제 변경 불일치",
          ]}
        />
        <ComparePanel
          title="ocul-pm"
          tone="primary"
          items={[
            "워처가 변경을 자동 수집 (index)",
            "에이전트가 journal 에 narrative 작성",
            "둘을 cross-reference 해 mismatch 감지 (W4)",
          ]}
        />
      </div>

      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
        <strong className="text-foreground">개인 개발자 1인 워크플로우</strong>
        에 최적화되어 있습니다. 모든 데이터는 로컬에 머무르며 외부 서비스로
        전송되지 않습니다.
      </div>
    </div>
  );
}

function ComparePanel({
  title,
  tone,
  items,
}: {
  title: string;
  tone: "dim" | "primary";
  items: string[];
}) {
  const toneClass =
    tone === "primary"
      ? "border-primary/40 bg-primary/5"
      : "border-border bg-muted/30";
  return (
    <div className={`rounded-xl border ${toneClass} p-4`}>
      <h3 className="text-sm font-semibold mb-2">{title}</h3>
      <ul className="space-y-1.5 text-xs">
        {items.map((it) => (
          <li key={it} className="flex items-start gap-2 leading-snug">
            <span className={tone === "primary" ? "text-primary" : "text-muted-foreground"}>
              ·
            </span>
            <span className="flex-1">{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Step 2: agents ──────────────────────────────────────────────────────

function Step2Agents({
  selected,
  onToggle,
}: {
  selected: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground leading-relaxed">
        ocul-pm 이 narrative 작성에 사용할 외부 LLM 을 선택하세요. 켠
        에이전트의 규칙 파일이 W4 부터 자동 동기화되어
        <code className="mx-1 px-1 py-0.5 rounded bg-muted text-xs">.oculpm/journal/</code>
        에 entry 를 쓰도록 안내합니다.
      </p>

      <div className="space-y-2">
        {KNOWN_AGENTS.map((agent) => {
          const checked = selected.has(agent.id);
          return (
            <label
              key={agent.id}
              className={`flex items-start gap-3 rounded-xl border p-3 cursor-pointer transition-colors ${
                checked
                  ? "border-primary/50 bg-primary/5"
                  : "border-border hover:bg-muted/50"
              }`}
            >
              <Checkbox
                checked={checked}
                onCheckedChange={() => onToggle(agent.id)}
                className="mt-0.5"
                aria-label={`${agent.label} 활성화`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <MessageCircle className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className="text-sm font-semibold">{agent.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {agent.description}
                  </span>
                </div>
                <code className="text-[11px] text-muted-foreground mt-0.5 inline-block">
                  {agent.adapterPath}
                </code>
              </div>
            </label>
          );
        })}
      </div>

      <div className="rounded-lg border border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground leading-relaxed">
        지금 켠 에이전트는 설정에 저장되지만 <strong className="text-foreground">실제 규칙 파일 동기화는 W4 부터</strong> 동작합니다.
        지금은 의도만 기록해두는 단계예요. 언제든 Settings 에서 변경 가능.
      </div>
    </div>
  );
}

// ─── Step 3: summary ─────────────────────────────────────────────────────

function Step3Summary({
  selectedAgents,
  agreed,
  onAgreedChange,
  error,
}: {
  selectedAgents: Set<string>;
  agreed: boolean;
  onAgreedChange: (v: boolean) => void;
  error: string | null;
}) {
  const agents = KNOWN_AGENTS.filter((a) => selectedAgents.has(a.id));
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground leading-relaxed">
        활성화하면 다음 파일/폴더가 프로젝트 루트 아래에 만들어지거나
        업데이트됩니다.
      </p>

      <div className="rounded-xl border border-border bg-muted/30 divide-y divide-border text-sm">
        <SummaryRow path=".oculpm/config.toml" note="ocul-pm 설정 (사용자 편집 가능)" />
        <SummaryRow path=".oculpm/index/" note="앱 ground truth — .gitignore 자동 추가" />
        <SummaryRow path=".oculpm/journal/" note="LLM 이 작성할 narrative 영역 — git 추적" />
        <SummaryRow path=".oculpm/.lock" note="다중 인스턴스 lock (자동 관리)" />
        <SummaryRow path=".gitignore" note="ocul-pm 관리 블록 멱등 갱신" />
        {agents.length === 0 ? (
          <div className="px-4 py-2.5 text-xs text-muted-foreground italic">
            (선택된 에이전트 없음 — W4 의 어댑터 sync 대상이 비어 있음)
          </div>
        ) : (
          agents.map((a) => (
            <SummaryRow
              key={a.id}
              path={a.adapterPath}
              note={`${a.label} 규칙 파일 (W4 부터 자동 sync)`}
            />
          ))
        )}
      </div>

      <label className="flex items-start gap-2.5 text-sm cursor-pointer">
        <Checkbox
          checked={agreed}
          onCheckedChange={(v) => onAgreedChange(v === true)}
          className="mt-0.5"
          aria-label="변경 동의"
        />
        <span className="leading-snug">
          위 변경 사항에 동의합니다. (활성화 후 Settings 에서 언제든 비활성화
          가능.)
        </span>
      </label>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
          {error}
        </div>
      )}
    </div>
  );
}

function SummaryRow({ path, note }: { path: string; note: string }) {
  return (
    <div className="px-4 py-2.5 flex items-start gap-3">
      <Check className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <code className="text-[12px] font-mono">{path}</code>
        <p className="text-[11px] text-muted-foreground mt-0.5">{note}</p>
      </div>
    </div>
  );
}
