// 미룬 지름길(defer) 원장 — 회고 화면의 EvalTrend 결 자기은닉 카드.
//
// 코드 주석에 남긴 defer 마커("oculpm-defer" 뒤 콜론)를 백엔드가 결정적으로
// 수확해 온다 (ponytail 의 부채 원장 이식). 마커가 0건이면 카드 자체를 그리지
// 않는다. RetroSignals 와 분리된 독립 커맨드라 회고 signature 를 오염시키지
// 않는다. 행 클릭은 diff/그래프 화면과 같은 openInEditor 경로로 file:line 을
// 연다 — 일지 전용 openEntryInEditor 가 아니라 일반 파일용 커맨드다.
import { useCallback, useEffect, useState } from "react";

import { Clock, TriangleAlert } from "@/components/Icons";
import { useSettings } from "@/contexts/SettingsContext";
import { useWorkspace } from "@/contexts/WorkspaceContext";
import { toast } from "@/lib/toast";
import { commands, type DeferSignals } from "@/lib/bindings";
import { t, useT } from "@/i18n";

/** 모듈 상수로 두면 임포트 시점에 언어가 굳는다 — 호출 시점에 해석하도록 함수로. */
const noTriggerTitle = () => t("retro.defer.hint");

export function DeferLedgerPanel({ projectId }: { projectId: number }) {
  const { t } = useT();
  const { state } = useWorkspace();
  const { settings } = useSettings();
  const projectRoot = state.currentProjectRoot;

  const [signals, setSignals] = useState<DeferSignals | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    setSignals(null);
    void commands.deferSignals(projectId).then((res) => {
      if (!alive) return;
      if (res.status === "ok") setSignals(res.data);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [projectId]);

  const openMarker = useCallback(
    async (path: string, line: number) => {
      if (!projectRoot) return;
      const res = await commands.openInEditor(
        projectRoot,
        path,
        settings.externalEditorCommand,
        line,
      );
      if (res.status === "error") toast.destructive(t("diff.editorFailed", { error: res.error }));
    },
    [projectRoot, settings.externalEditorCommand],
  );

  // 마커가 하나도 없으면(또는 수확 실패면) 아무것도 그리지 않는다.
  if (!loaded || !signals || signals.markers.length === 0) return null;

  return (
    <div className="rounded-lg border border-border/60 bg-card p-4">
      <div className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-foreground">
        <span className="text-muted-foreground">
          <Clock size={15} />
        </span>
        {t("retro.defer.title")}
        <span className="text-xs font-normal text-muted-foreground">
          {t("retro.defer.count", { n: signals.markers.length })}
        </span>
      </div>
      <p className="mb-2.5 text-xs text-muted-foreground">
        {t("retro.defer.desc1")} <code className="font-mono text-[11px]">oculpm-defer:</code>{" "}
        {t("retro.defer.desc2")}
      </p>
      <ul className="flex flex-col gap-1.5">
        {signals.markers.map((m) => (
          <li key={`${m.path}:${m.line}`} className="flex items-baseline gap-2 text-sm">
            <button
              type="button"
              className="shrink-0 font-mono text-xs text-primary hover:underline"
              onClick={() => void openMarker(m.path, m.line)}
              title={t("diff.openEditor")}
            >
              {m.path}:{m.line}
            </button>
            <span className="min-w-0 flex-1 truncate text-foreground" title={m.ceiling}>
              {m.ceiling}
            </span>
            {m.no_trigger ? (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400"
                title={noTriggerTitle()}
              >
                <TriangleAlert size={12} /> {t("retro.defer.noTrigger")}
              </span>
            ) : (
              <span
                className="max-w-[40%] shrink-0 truncate text-xs text-muted-foreground"
                title={m.trigger ?? undefined}
              >
                {m.trigger}
              </span>
            )}
          </li>
        ))}
      </ul>
      {signals.truncated && (
        <p className="mt-2 text-xs text-muted-foreground">{t("retro.defer.capped")}</p>
      )}
    </div>
  );
}
