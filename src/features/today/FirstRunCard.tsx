import { Sparkles, GitCompareArrows } from "@/components/Icons";
import type { UiV2View, OculpmInitCardInfo } from "@/contexts/WorkspaceContext";
import { useT } from "@/i18n";

// 첫 활성화 1회 카드 (완성도 라운드 Phase 2, 2026-08-30).
//
// `.oculpm` init 은 저장소에 파일을 **쓴다** — `.oculpm/`, `AGENTS.md` 블록,
// `.gitignore` 한 줄. 그동안은 아무 말 없이 썼고, 그린필드 마법사 문구만 존재
// 하지 않는 "활성화 카드" 를 약속하고 있었다. 이 카드가 그 약속이다: 무엇을
// 썼는지 그대로 나열하고, 커밋하라고 한 번 말한 뒤 사라진다.
//
// 표시 조건은 워크스페이스의 `oculpmInitCard` (config.toml 을 새로 쓴 진짜
// 첫 init 에만 채워진다) — 이전부터 쓰던 프로젝트는 이 빌드로 올라와도 보지
// 않는다.

export function FirstRunCard({
  info,
  onDismiss,
  onNavigate,
}: {
  info: OculpmInitCardInfo;
  onDismiss: () => void;
  onNavigate: (view: UiV2View) => void;
}) {
  const { t } = useT();
  const lines: string[] = [
    ...(info.wroteConfig || info.createdDirs.length > 0 ? [t("today.firstRun.oculpmDir")] : []),
    ...info.agentFiles.map((file) => t("today.firstRun.agentFile", { file })),
    ...(info.wroteGitignore ? [t("today.firstRun.gitignore")] : []),
  ];
  return (
    <div className="card card-pad first-run-card" role="status" style={{ marginBottom: 16 }}>
      <div className="stat-top">
        <Sparkles size={15} color="var(--accent-text)" />
        <strong>{t("today.firstRun.title")}</strong>
      </div>
      <div className="first-run-sub">{t("today.firstRun.sub")}</div>
      <ul className="first-run-list mono">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="first-run-actions">
        <button className="btn primary sm" onClick={() => onNavigate("diff")}>
          <GitCompareArrows size={13} /> {t("today.firstRun.viewChanges")}
        </button>
        <button className="btn sm" onClick={onDismiss}>
          {t("today.firstRun.dismiss")}
        </button>
      </div>
    </div>
  );
}
