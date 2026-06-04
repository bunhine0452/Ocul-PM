/**
 * EmptyToday V2 — `.oculpm/` 는 활성화됐지만 오늘은 기록이 없고 파일 변경도
 * 없는 상태. "어서 코드를 만지세요" 가이드.
 *
 * 참조: docs/major_update/oculpm/W3/PR5-empty-today-onboarding.md §1.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar, Plus } from "@/components/Icons";

interface EmptyTodayV2Props {
  workdayKey: string | null;
  onCreateManual: () => void;
}

export function EmptyTodayV2({ workdayKey, onCreateManual }: EmptyTodayV2Props) {
  const [explainerOpen, setExplainerOpen] = useState(false);
  return (
    <section
      className="rounded-2xl border border-border bg-card p-8 max-w-2xl mx-auto"
      role="region"
      aria-label="오늘의 기록 없음"
    >
      <div className="flex flex-col items-center text-center gap-3">
        <div className="rounded-xl bg-muted p-3">
          <Calendar className="w-6 h-6 text-muted-foreground" />
        </div>
        <h2 className="text-base font-semibold">
          오늘은 아직 기록이 없습니다
        </h2>
        <p className="text-sm text-muted-foreground max-w-md leading-relaxed">
          파일을 수정하면 ocul-pm 워처가 자동으로 추적하고, narrative 가
          작성되면 여기에 카드로 쌓입니다. 직접 entry 를 작성할 수도
          있습니다.
        </p>
        {workdayKey && (
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground tabular-nums">
            workday {workdayKey}
          </p>
        )}
        <div className="flex items-center gap-2 mt-2">
          <Button onClick={onCreateManual} size="sm">
            <Plus className="w-3.5 h-3.5" />
            수동 entry 작성
          </Button>
          <Popover open={explainerOpen} onOpenChange={setExplainerOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm">
                어떻게 동작하나요?
              </Button>
            </PopoverTrigger>
            <PopoverContent className="text-xs leading-relaxed max-w-sm">
              <p>
                ocul-pm 워처가 프로젝트 루트의 파일 변경을 감지해
                <code className="mx-1 px-1 py-0.5 rounded bg-muted text-[11px]">.oculpm/index/</code>
                에 ground truth 를 적습니다. 외부 LLM 이 설치된 어댑터 규칙
                파일을 따라
                <code className="mx-1 px-1 py-0.5 rounded bg-muted text-[11px]">.oculpm/journal/</code>
                에 markdown narrative 를 떨궈주면, 다음 reindex 또는 watcher
                이벤트가 cache 를 갱신해 Today 에 카드로 표시됩니다.
              </p>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </section>
  );
}
