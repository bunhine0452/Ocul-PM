// 인덱스 사용량 — `.oculpm/index/` 가 지금 먹는 디스크 (플랜 `journal-scale-round`
// {#index-usage}). `DoctorSection`/`FiringInsights` 와 같은 규약으로 진단 탭에서
// 갈라 낸 자기완결 조각이다 — `useOptionalWorkspace` 로 스스로 프로젝트를 읽는다.
//
// 이 저장소 자신이 표본이다: 일지 원문 4MB에 index/ 는 330MB — 로컬 히스토리
// 판(280MB)은 이미 코드 설정이 다루니, 여기서는 diff 캡처(39MB) + 그 밖까지
// 세 갈래로 보여주고 diff 만 지우는 손잡이를 낸다(전문 스냅샷과 달리 diff 는
// git 에서 다시 만들 수 있어 잃을 것이 적다).

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format";
import { toast } from "@/lib/toast";
import { useT } from "@/i18n";
import { blocked } from "@/lib/blocked";
import { Section, Stat } from "./ui";
import { indexUsageApi } from "@/api/indexUsage";
import { toAppError } from "@/api/invoke";
import { tError } from "@/i18n/errors";
import { useOptionalWorkspace } from "@/contexts/WorkspaceContext";
import { useConfirm } from "@/hooks/useConfirm";
import { openSettings } from "@/lib/settingsNav";
import type { IndexUsage } from "@/lib/bindings";

/** 크기 지표는 f64 라 바인딩이 `number | null` 로 낸다 — 숫자일 때만 표기. */
function fmtBytes(n: number | null | undefined): string | undefined {
  return typeof n === "number" ? formatBytes(n) : undefined;
}

export function IndexUsageSection() {
  const { t } = useT();
  const projectId = useOptionalWorkspace()?.state.currentProjectId ?? null;
  const [usage, setUsage] = useState<IndexUsage | null>(null);
  const [deletingDiffs, setDeletingDiffs] = useState(false);
  const { confirm, confirmDialog } = useConfirm();

  const loadUsage = useCallback(async () => {
    if (projectId == null) {
      setUsage(null);
      return;
    }
    try {
      setUsage(await indexUsageApi.usage(projectId));
    } catch {
      setUsage(null);
    }
  }, [projectId]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  const clearDiffs = useCallback(async () => {
    if (projectId == null) return;
    const ok = await confirm({
      title: t("settings.idxUsage.clearDiffsConfirmTitle"),
      message: t("settings.idxUsage.clearDiffsConfirmBody"),
      confirmLabel: t("settings.idxUsage.clearDiffs"),
      danger: true,
    });
    if (!ok) return;
    setDeletingDiffs(true);
    try {
      await indexUsageApi.clearDiffs(projectId);
      toast.info(t("settings.idxUsage.diffsCleared"));
      await loadUsage();
    } catch (e) {
      toast.destructive(tError(toAppError(e)));
    } finally {
      setDeletingDiffs(false);
    }
  }, [projectId, confirm, t, loadUsage]);

  /** 바이트 + 파일 수 한 줄 — `usage` 가 아직 안 왔으면 `undefined`(Stat 이 "—"). */
  function usageStat(bytes: number | null | undefined, files: number): string | undefined {
    if (usage == null) return undefined;
    return t("settings.idxUsage.usageLine", { bytes: fmtBytes(bytes) ?? "0 B", count: files });
  }

  return (
    <>
      <Section title={t("settings.idxUsage.title")} description={t("settings.idxUsage.desc")}>
        {projectId == null ? (
          <p className="text-xs text-muted-foreground">{t("settings.idxUsage.noProject")}</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <Stat
                label={t("settings.idxUsage.history")}
                value={usageStat(usage?.history_bytes, usage?.history_files ?? 0)}
              />
              <Stat
                label={t("settings.idxUsage.diffs")}
                value={usageStat(usage?.diffs_bytes, usage?.diffs_files ?? 0)}
              />
              <Stat label={t("settings.idxUsage.other")} value={fmtBytes(usage?.other_bytes)} />
            </div>
            <div className="text-fs-2 text-muted-foreground">
              {t("settings.idxUsage.total")}{" "}
              <span className="font-mono text-foreground/80">
                {fmtBytes(usage?.total_bytes) ?? "…"}
              </span>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button
                onClick={() => void clearDiffs()}
                {...blocked(
                  !usage || (usage.diffs_bytes ?? 0) === 0
                    ? t("settings.idxUsage.blockedDiffsEmpty")
                    : null,
                )}
                disabled={deletingDiffs}
                variant="outline"
                size="sm"
              >
                {deletingDiffs ? t("settings.idxUsage.clearingDiffs") : t("settings.idxUsage.clearDiffs")}
              </Button>
              <Button onClick={() => openSettings("code")} variant="outline" size="sm">
                {t("settings.idxUsage.openCodeSettings")}
              </Button>
            </div>
            <div className="text-fs-2 text-muted-foreground">{t("settings.idxUsage.historyHint")}</div>
          </>
        )}
      </Section>
      {confirmDialog}
    </>
  );
}
