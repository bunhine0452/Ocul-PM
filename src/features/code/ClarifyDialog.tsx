import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Sparkles, X } from "@/components/Icons";
import type { ClarifyQuestion, ClarifyAnswer } from "@/lib/bindings";

// MASTER-GUIDE §5.8 — Clarify Dialog
//
// Receives the questions produced by the backend `clarify_edit_intent`
// command, collects answers from the user, and emits a `ClarifyAnswer[]`
// payload on submit. The parent (AiWorkbench) is responsible for the next
// step (calling `generate_edit_prompt_with_answers`).
//
// Closes on:
//   - Esc / backdrop click → onCancel (user dismisses, parent decides if it
//     should proceed without clarification)
//   - "건너뛰기" button → onSubmit([]) (proceed with empty answers)
//   - "답변하고 진행 →" button → onSubmit(<filled answers>)

interface ClarifyDialogProps {
  open: boolean;
  ambiguityScore: number;
  questions: ClarifyQuestion[];
  busy?: boolean;
  onSubmit: (answers: ClarifyAnswer[]) => void;
  onCancel: () => void;
}

export function ClarifyDialog({
  open,
  ambiguityScore,
  questions,
  busy = false,
  onSubmit,
  onCancel,
}: ClarifyDialogProps) {
  const [draftAnswers, setDraftAnswers] = useState<Record<string, string>>({});

  // Reset draft state every time the dialog re-opens with a fresh question
  // set — otherwise answers from a prior unrelated query leak in.
  useEffect(() => {
    if (open) setDraftAnswers({});
  }, [open, questions]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  const allAnswered = useMemo(
    () => questions.every((q) => (draftAnswers[q.id] ?? "").trim().length > 0),
    [questions, draftAnswers],
  );

  if (!open) return null;

  function handleSubmit() {
    const answers: ClarifyAnswer[] = questions.map((q) => ({
      id: q.id,
      answer: draftAnswers[q.id] ?? "",
    }));
    onSubmit(answers);
  }

  return (
    <div
      className="fixed inset-0 z-[95] bg-background/70 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="bg-card border border-border rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col animate-in zoom-in-95 duration-150">
        <header className="px-5 py-3 border-b border-border flex items-center gap-2 shrink-0">
          <Sparkles className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-bold flex-1">🤔 조금 더 알려주세요</h2>
          <span className="text-[10px] text-muted-foreground font-mono tabular-nums">
            ambiguity {ambiguityScore.toFixed(2)}
          </span>
          <button
            onClick={onCancel}
            disabled={busy}
            className="p-1.5 rounded-lg hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer disabled:opacity-40"
            title="닫기 (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="p-5 space-y-4">
          {questions.length === 0 && (
            <p className="text-sm text-muted-foreground">
              명확화 질문이 없습니다. 바로 진행하세요.
            </p>
          )}

          {questions.map((q, i) => (
            <fieldset key={q.id} className="space-y-2">
              <legend className="text-xs font-semibold flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-primary/10 text-primary inline-flex items-center justify-center text-[10px] font-bold">
                  {i + 1}
                </span>
                {q.text}
              </legend>

              {q.kind === "choice" ? (
                <div className="flex flex-wrap gap-1.5 pl-7">
                  {(q.options ?? []).map((opt) => {
                    const checked = draftAnswers[q.id] === opt;
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => setDraftAnswers((p) => ({ ...p, [q.id]: opt }))}
                        className={`px-3 py-1 rounded-full text-xs font-semibold border transition-colors ${
                          checked
                            ? "bg-primary text-primary-foreground border-primary"
                            : "border-border text-muted-foreground hover:text-foreground hover:bg-accent/40"
                        }`}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="pl-7">
                  <Input
                    value={draftAnswers[q.id] ?? ""}
                    onChange={(e) =>
                      setDraftAnswers((p) => ({ ...p, [q.id]: e.target.value }))
                    }
                    placeholder="자유 입력"
                    className="h-8 text-xs"
                  />
                </div>
              )}
            </fieldset>
          ))}
        </div>

        <footer className="px-5 py-3 border-t border-border flex items-center justify-end gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onSubmit([])}
            disabled={busy}
            title="명확화 답변 없이 진행합니다"
          >
            건너뛰기
          </Button>
          <Button
            size="sm"
            onClick={handleSubmit}
            disabled={busy || (!allAnswered && questions.length > 0)}
          >
            {busy ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                생성 중…
              </>
            ) : (
              <>답변하고 진행 →</>
            )}
          </Button>
        </footer>
      </div>
    </div>
  );
}
