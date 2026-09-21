import { useEffect, useState } from "react";

import { claudeInstallApi } from "@/api/claudeSurface";
import { ErrorCard } from "@/components/ErrorCard";
import {
  Activity,
  ArrowRight,
  Check,
  GitCompareArrows,
  Loader,
  NotebookText,
  Terminal,
  X,
} from "@/components/Icons";
import type { UiV2View } from "@/contexts/WorkspaceContext";
import { agoText } from "@/features/sessions/sessionModel";
import { useMinuteTick } from "@/hooks/useSecondTick";
import { useT, type I18nKey } from "@/i18n";
import { deriveFirstRecord, probe3, shortConversation, type Probe3 } from "./firstRecordModel";
import { useFirstRecord } from "./useFirstRecord";

// 첫 기록 카드 (플랜 `first-record-loop` {#p1-card} · 보고서 §7).
//
// Today 가 "기록이 시작됐다"를 아는 유일한 방법은 `total_entries` 였다. 그
// 숫자는 백필로도, 옆 대화의 일지로도 오른다 — 방금 돌린 에이전트가 기록했는지는
// 말하지 못한다. 이 카드는 **대화 단위 원장**(`first_record_ledger`)을 읽어
// 「이 대화가 자기 첫 일지를 남겼다」만 성공으로 말한다. 나머지는 전부 "아직"
// 이거나 "모름"이다.
//
// 뜨는 조건은 부르는 쪽이 정한다 — 프로젝트에 일지가 0건일 때 한 번 armed 되고
// (`firstRecordArmed`, 프로젝트별 영속), 사용자가 「확인했어요」나 닫기를 누를
// 때까지 남는다. 이전부터 쓰던 프로젝트는 armed 된 적이 없어 보지 않는다.
//
// 기록 ≠ 검증. 성공 상태의 문구가 그 둘을 가른다 — "기록이 남았다는 뜻이지
// 코드가 검증됐다는 뜻은 아니에요".

const PROBE_LABEL: Record<Probe3, I18nKey> = {
  yes: "today.firstRecord.probe.yes",
  no: "today.firstRecord.probe.no",
  unknown: "today.firstRecord.probe.unknown",
};

interface Probes {
  cli: Probe3;
  plugin: Probe3;
}

export function FirstRecordCard({
  projectId,
  enabled,
  onNavigate,
  onOpenEntryPath,
  onRunAgent,
  onDone,
}: {
  projectId: number;
  /** armed ∧ oculpm 활성 — 부르는 쪽이 판단한다. */
  enabled: boolean;
  onNavigate: (view: UiV2View) => void;
  /** 그 대화의 첫 일지를 일지 화면에서 연다. */
  onOpenEntryPath: (relativePath: string) => void;
  /** Today 의 빠른 터미널을 편다 — 「여기서 에이전트 실행」과 같은 자리. */
  onRunAgent: () => void;
  /** 「확인했어요」·닫기 — 카드를 내리고 다시 띄우지 않는다. */
  onDone: () => void;
}) {
  const { t } = useT();
  const { ledger, loaded, error, refresh } = useFirstRecord(projectId, enabled);
  const now = useMinuteTick(enabled);
  const view = ledger ? deriveFirstRecord(ledger) : null;

  // 준비 상태에서만 CLI·플러그인을 묻는다 — 다른 상태에서는 답을 쓸 데가 없다.
  // 실패는 「확인 못 함」으로 남긴다: 추측으로 「없음」을 그리지 않는다.
  const [probes, setProbes] = useState<Probes | null>(null);
  const wantProbes = enabled && view?.kind === "ready";
  useEffect(() => {
    if (!wantProbes || probes) return;
    let alive = true;
    void Promise.all([claudeInstallApi.cli("claude"), claudeInstallApi.pluginStatus()]).then(
      ([cli, plugin]) => {
        if (!alive) return;
        setProbes({ cli: probe3(cli?.available), plugin: probe3(plugin?.installed) });
      },
    );
    return () => {
      alive = false;
    };
  }, [wantProbes, probes]);

  if (!enabled) return null;
  if (error && loaded) {
    return <ErrorCard title={t("today.firstRecord.loadFailed")} error={error} onRetry={refresh} />;
  }
  if (!view) return null;

  const dismiss = (
    <button
      className="btn ghost sm right"
      onClick={onDone}
      aria-label={t("common.dismiss")}
      title={t("today.firstRecord.dismissHint")}
    >
      <X size={13} />
    </button>
  );

  if (view.kind === "recorded") {
    const id = shortConversation(view.conversation.conversation);
    return (
      <div className="card card-pad first-run-card" role="status" data-first-record="recorded">
        <div className="stat-top">
          <Check size={15} color="var(--accent-text)" />
          <strong>{t("today.firstRecord.recorded.title")}</strong>
          {dismiss}
        </div>
        {/* SVG 는 block 이라 인라인로 두면 제목 위 줄로 떨어진다 — flex 한 줄. */}
        <div className="first-run-sub" style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <NotebookText size={13} />
          <b style={{ minWidth: 0 }}>{view.journal.title}</b>
        </div>
        <div className="first-run-sub" style={{ color: "var(--text-3)" }}>
          {t("today.firstRecord.recorded.body", { id })}
        </div>
        <div className="first-run-actions">
          <button
            className="btn primary sm"
            onClick={() => onOpenEntryPath(view.journal.relative_path)}
          >
            {t("today.firstRecord.recorded.open")} <ArrowRight size={13} />
          </button>
          <button className="btn sm" onClick={() => onNavigate("diff")}>
            <GitCompareArrows size={13} /> {t("today.firstRecord.recorded.review")}
          </button>
          <button className="btn sm" onClick={onDone}>
            {t("today.firstRecord.recorded.ack")}
          </button>
        </div>
      </div>
    );
  }

  if (view.kind === "running") {
    const id = shortConversation(view.conversation.conversation);
    const since = view.conversation.started_at ? agoText(view.conversation.started_at, now) : null;
    return (
      <div className="card card-pad" role="status" data-first-record="running">
        <div className="stat-top">
          <Loader size={15} color="var(--accent-text)" />
          <strong>{t("today.firstRecord.running.title")}</strong>
          {dismiss}
        </div>
        <div className="first-run-sub">{t("today.firstRecord.running.body")}</div>
        <div className="first-run-sub mono" style={{ color: "var(--text-3)" }}>
          {since
            ? t("today.firstRecord.running.metaSince", { id, since })
            : t("today.firstRecord.running.meta", { id })}
          {view.liveCount > 1
            ? ` · ${t("today.firstRecord.running.more", { n: view.liveCount - 1 })}`
            : null}
        </div>
      </div>
    );
  }

  if (view.kind === "missing") {
    const id = shortConversation(view.conversation.conversation);
    return (
      <div className="card card-pad" role="status" data-first-record="missing">
        <div className="stat-top">
          <NotebookText size={15} color="var(--warn)" />
          <strong>{t("today.firstRecord.missing.title")}</strong>
          {dismiss}
        </div>
        <div className="first-run-sub">{t("today.firstRecord.missing.body", { id })}</div>
        <div className="first-run-actions">
          <button className="btn primary sm" onClick={onRunAgent}>
            <Terminal size={13} /> {t("today.firstRecord.missing.retry")}
          </button>
        </div>
      </div>
    );
  }

  if (view.kind === "unattributed") {
    return (
      <div className="card card-pad" role="status" data-first-record="unattributed">
        <div className="stat-top">
          <NotebookText size={15} color="var(--text-2)" />
          <strong>{t("today.firstRecord.unattributed.title")}</strong>
          {dismiss}
        </div>
        <div className="first-run-sub">
          {t("today.firstRecord.unattributed.body", { n: view.count })}
        </div>
        <div className="first-run-actions">
          <button className="btn sm" onClick={() => onNavigate("journal")}>
            {t("today.firstRecord.unattributed.open")} <ArrowRight size={13} />
          </button>
          <button className="btn sm" onClick={onDone}>
            {t("today.firstRecord.recorded.ack")}
          </button>
        </div>
      </div>
    );
  }

  // ready — 관측된 대화가 없다. 준비 상태 셋: 설정 존재(CLI·플러그인)와 실제
  // 연결(훅이 이 프로젝트에서 세션을 본 적이 있는가)을 **따로** 말한다.
  return (
    <div className="card card-pad" role="status" data-first-record="ready">
      <div className="stat-top">
        <Activity size={15} color="var(--text-2)" />
        <strong>{t("today.firstRecord.ready.title")}</strong>
        {dismiss}
      </div>
      <div className="first-run-sub">{t("today.firstRecord.ready.body")}</div>
      <ul className="first-run-list">
        <li>
          {t("today.firstRecord.probe.cli")} · {t(PROBE_LABEL[probes?.cli ?? "unknown"])}
        </li>
        <li>
          {t("today.firstRecord.probe.plugin")} · {t(PROBE_LABEL[probes?.plugin ?? "unknown"])}
        </li>
        <li>
          {t("today.firstRecord.probe.hooks")} ·{" "}
          {view.hooksSeen
            ? t("today.firstRecord.probe.hooksSeen")
            : t("today.firstRecord.probe.hooksNotYet")}
        </li>
      </ul>
      <div className="first-run-actions">
        <button className="btn primary sm" onClick={onRunAgent}>
          <Terminal size={13} /> {t("today.firstRecord.run")}
        </button>
      </div>
    </div>
  );
}
