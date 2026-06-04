/**
 * EmptyToday V1 — `.oculpm/` 가 활성화되지 않은 프로젝트.
 *
 * 사용자가 onboarding 모달을 거쳐 init 하거나, "나중에" 를 눌러 dismiss
 * 할 수 있다. dismiss 한 사용자에게는 TodayScreen 상단 status bar 의
 * "ocul-pm 비활성화 — 활성화" 링크가 재진입 경로가 된다 (PR5 TodayScreen
 * 분기에서 처리).
 *
 * 참조: docs/major_update/oculpm/W3/PR5-empty-today-onboarding.md §1.
 */

import { Button } from "@/components/ui/button";
import { OculIcon, Sparkles } from "@/components/Icons";

interface EmptyTodayV1Props {
  onActivate: () => void;
  onDismiss: () => void;
}

export function EmptyTodayV1({ onActivate, onDismiss }: EmptyTodayV1Props) {
  return (
    <section
      className="rounded-2xl border border-primary/30 bg-primary/5 p-8 max-w-2xl mx-auto"
      role="region"
      aria-label="ocul-pm 활성화 안내"
    >
      <div className="flex items-start gap-4">
        <div className="rounded-xl bg-primary/15 p-3 shrink-0">
          <OculIcon className="w-6 h-6 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-bold tracking-tight">
            ocul-pm 으로 이 프로젝트를 추적할까요?
          </h2>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            ocul-pm 은 코드 변경과 작업 narrative 를 <code className="text-xs px-1.5 py-0.5 rounded bg-muted">.oculpm/</code> 폴더에 자동 기록해, Today
            탭에 그날의 흐름을 시간순으로 보여줍니다. 외부 LLM (Claude Code,
            Cursor 등) 이 작업한 내용도 자동으로 narrative 로 정리됩니다.
          </p>

          <ul className="mt-4 space-y-1.5 text-sm">
            <FeatureBullet>
              파일 변경을 실시간으로 추적 (워처 + 세션)
            </FeatureBullet>
            <FeatureBullet>
              <code className="text-xs px-1 py-0.5 rounded bg-muted">.oculpm/journal/</code> 에 markdown 으로 narrative 기록
            </FeatureBullet>
            <FeatureBullet>
              W4 부터 외부 LLM 이 규칙 파일을 통해 자동 작성
            </FeatureBullet>
          </ul>

          <div className="mt-6 flex items-center gap-2">
            <Button onClick={onActivate} size="default">
              <Sparkles className="w-4 h-4" />
              활성화
            </Button>
            <Button onClick={onDismiss} variant="ghost" size="default">
              나중에
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

function FeatureBullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 leading-snug">
      <span className="text-primary shrink-0 mt-0.5">·</span>
      <span className="flex-1">{children}</span>
    </li>
  );
}
