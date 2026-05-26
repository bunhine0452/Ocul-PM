/**
 * EmptyToday V3 — `.oculpm/` 활성, 오늘 file_changes 는 있지만 journal
 * narrative 가 0인 상태. **외부 LLM 이 어댑터 규칙을 안 따른 신호** —
 * 페이즈 §0 의 R-1 (LLM 무시) 완화책의 핵심 UI.
 *
 * W4 에서:
 *  - 어댑터 상태 자동 점검 결과를 카드 안에 표시
 *  - `index 비교` 버튼이 DiffVsNarrative 모달을 띄움
 *
 * W3 에서는 둘 다 stub — 어댑터 안내 문구 + disabled 버튼 + tooltip.
 *
 * 참조: docs/major_update/oculpm/W3/PR5-empty-today-onboarding.md §1.
 */

import { Button } from "@/components/ui/button";
import { AlertTriangle, Plus, GitBranch } from "@/components/Icons";

interface EmptyTodayV3Props {
  fileChangeCount: number;
  onCreateManual: () => void;
  /** W4-PR6 — open DiffVsNarrative for the most recent session, if any.
   *  `null` disables the button (no session to compare against). */
  onCompareLayers: (() => void) | null;
}

export function EmptyTodayV3({
  fileChangeCount,
  onCreateManual,
  onCompareLayers,
}: EmptyTodayV3Props) {
  return (
    <section
      className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-8 max-w-2xl mx-auto"
      role="region"
      aria-label="narrative 누락 경고"
    >
      <div className="flex items-start gap-4">
        <div className="rounded-xl bg-amber-500/15 p-3 shrink-0">
          <AlertTriangle className="w-6 h-6 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold">narrative 누락</h2>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            오늘{" "}
            <strong className="text-foreground tabular-nums">
              {fileChangeCount}
            </strong>
            개의 파일이 변경됐지만 narrative 가 작성되지 않았습니다. 외부
            LLM 이 어댑터 규칙을 따르지 않았을 가능성이 큽니다.
          </p>

          <div className="mt-5 flex items-center gap-2">
            <Button onClick={onCreateManual} size="sm">
              <Plus className="w-3.5 h-3.5" />
              수동 entry 작성
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onCompareLayers ?? undefined}
              disabled={onCompareLayers == null}
              title={onCompareLayers ? "가장 최근 세션을 index 와 비교합니다" : "비교 대상 세션이 없습니다"}
              aria-label="index 비교 보기"
            >
              <GitBranch className="w-3.5 h-3.5" />⚖ index 비교 보기
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
