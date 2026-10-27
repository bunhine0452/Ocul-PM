import { useEffect, useState } from "react";

import { claudeInstallApi } from "@/api/claudeSurface";
import { Puzzle } from "@/components/Icons";
import { EmptyState } from "@/components/EmptyState";
import { useT } from "@/i18n";
import type { ClaudePluginStatus } from "@/lib/bindings";
import { toast } from "@/lib/toast";

// 플러그인 판 드리프트 (완성도 라운드 2026-10-27, 업그레이드 1).
//
// 실측: 작성자 기기에서 이 저장소의 플러그인이 3.3.0(09-21 설치)으로 5주째 멈춰 있어
// SessionStart 훅이 마지막 일지 3건도, 전달 원장도 쓰지 않았다 — 「이어하기」 카드가
// 9월부터 빈 채였다. 프로젝트 스코프 설치는 스스로 올라가지 않고, 앱은 그 사실을
// 몰랐다. 이 카드는 **그 프로젝트에 적용되는 판**이 앱의 판보다 낮을 때만 그린다.
// 판정은 Claude Code 의 레지스트리(installed_plugins.json)에서 — 추측 배지가 아니다.
//
// 안 그리는 경우: 미설치(그건 PluginSetupCard 의 몫) · 판을 못 읽음 · 같거나 높음.

export function PluginDriftCard({ projectId, enabled }: { projectId: number; enabled: boolean }) {
  const { t } = useT();
  const [status, setStatus] = useState<ClaudePluginStatus | null>(null);

  useEffect(() => {
    if (!enabled) {
      setStatus(null);
      return;
    }
    let alive = true;
    void claudeInstallApi.pluginStatus(projectId).then((p) => {
      if (alive) setStatus(p);
    });
    return () => {
      alive = false;
    };
  }, [projectId, enabled]);

  if (!enabled || !status?.behind || !status.installed_version) return null;

  const copy = () => {
    void navigator.clipboard
      ?.writeText("/plugin update oculpm@oculpm")
      .then(() => toast.info(t("today.pluginDrift.copied")));
  };

  return (
    <div className="card card-pad" role="status">
      <div className="stat-top">
        <Puzzle size={15} color="var(--warn-text)" />
        <strong>
          {t("today.pluginDrift.title", { installed: status.installed_version, bundled: status.bundled_version })}
        </strong>
      </div>
      <EmptyState style={{ margin: "6px 0 0" }}>{t("today.pluginDrift.body")}</EmptyState>
      <div className="first-run-actions">
        <code className="mono" style={{ fontSize: "var(--fs-2)" }}>
          /plugin update oculpm@oculpm
        </code>
        <button className="btn sm" onClick={copy}>
          {t("today.pluginDrift.copy")}
        </button>
      </div>
    </div>
  );
}
