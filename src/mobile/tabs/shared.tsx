// 모바일 탭 공용 조각 — 데스크톱 시각 어휘(트리거 색 칩·agentColor 스와치·
// 검증 체크)를 그대로 쓴다. 밀도만 폰에 맞춘다 (플랜 D6).
import type { EntryType, JournalEntrySummary } from "@/lib/bindings";
import { Check } from "@/components/Icons";
import { agentColor, agentLabel } from "@/features/today/agentColor";
import { useT } from "@/i18n";
import { OculSpinner } from "@/components/OculSpinner";

export function Loading() {
  return (
    <div className="p-8 flex justify-center">
      <OculSpinner />
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useT();
  return (
    <div className="p-6 text-center space-y-3">
      <p className="text-sm mob-danger whitespace-pre-wrap">{message}</p>
      {onRetry ? (
        <button onClick={onRetry} className="mob-btn-soft px-4 py-2 text-sm">
          {t("mobile.common.retry")}
        </button>
      ) : null}
    </div>
  );
}

/** 일지 타입 칩 — 데스크톱 트리거 색(--t-*) 그대로. */
export function TypeChip({ type }: { type: EntryType }) {
  return <span className={`mob-chip t-${type}`}>{type}</span>;
}

/** 에이전트 스와치 + 라벨 — 데스크톱 agentColor 결정론 팔레트 재사용. */
export function AgentTag({ agentId }: { agentId: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] mob-text-2">
      <span className="mob-agent-dot" style={{ background: agentColor(agentId) }} aria-hidden />
      {agentLabel(agentId)}
    </span>
  );
}

export function EntryList({ entries, onOpen }: {
  entries: JournalEntrySummary[];
  onOpen: (e: JournalEntrySummary) => void;
}) {
  return (
    <ul className="space-y-2">
      {entries.map((e) => (
        <li key={e.relative_path}>
          <button onClick={() => onOpen(e)} className="mob-card w-full text-left px-3.5 py-2.5">
            <div className="flex items-center gap-2">
              <TypeChip type={e.type} />
              <span className="text-[13px] font-medium truncate flex-1">{e.title}</span>
              {e.verified_by_user ? (
                <Check size={13} className="mob-verified shrink-0" aria-hidden />
              ) : null}
            </div>
            <div className="flex items-center gap-2.5 mt-1.5">
              <AgentTag agentId={e.agent_id} />
              <span className="text-[11px] mob-text-3">{e.created_at.slice(11, 16)}</span>
              {e.files_count > 0 ? (
                <span className="text-[11px] mob-text-3">{e.files_count} files</span>
              ) : null}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}
