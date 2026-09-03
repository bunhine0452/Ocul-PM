import { useCallback, useEffect, useState } from "react";
import { Network } from "@/components/Icons";
import { useT } from "@/i18n";
import { tError } from "@/i18n/errors";
import { toAppError } from "@/api/invoke";
import { oculpmApi } from "@/api/oculpm";
import type { A2aServerStatus } from "@/lib/bindings";

// 외부 A2A 문 (docs/a2a/00-master-plan.md §10).
//
// **기본은 닫혀 있다.** 여는 것은 사용자의 명시적 행동이고, 열려도 127.0.0.1
// 에만 열린다. 토큰은 켤 때마다 새로 만들어 디스크에 남기지 않으므로 — 저장하지
// 않는 비밀은 새지 않는다 — 화면에 뜬 그 순간이 유일한 전달 경로다. 그래서
// "다시 볼 수 없다"고 미리 말한다.
export function A2aEndpointBlock({ projectId }: { projectId: number | null }) {
  const { t } = useT();
  const [status, setStatus] = useState<A2aServerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void oculpmApi
      .a2aEndpointStatus()
      .then(setStatus)
      .catch((e: unknown) => setError(tError(toAppError(e))));
  }, []);

  useEffect(refresh, [refresh]);

  const toggle = async () => {
    if (projectId == null) return;
    setBusy(true);
    setError(null);
    try {
      setStatus(
        status?.running
          ? await oculpmApi.a2aEndpointStop()
          : await oculpmApi.a2aEndpointStart(projectId),
      );
    } catch (e) {
      setError(tError(toAppError(e)));
    } finally {
      setBusy(false);
    }
  };

  const running = status?.running ?? false;

  return (
    <div className="card card-pad" style={{ marginTop: 12 }}>
      <div className="stat-top">
        <Network size={15} color="var(--accent-text)" />
        <strong>{t("a2a.endpoint.title")}</strong>
        <span className="empty-hint right">
          {running ? t("a2a.endpoint.running") : t("a2a.endpoint.off")}
        </span>
      </div>
      <p className="empty-hint" style={{ margin: "6px 0 0" }}>
        {t("a2a.endpoint.desc")}
      </p>

      {running && status?.url ? (
        <div className="a2a-list" style={{ marginTop: 8 }}>
          <div>
            <code>{status.url}</code>
          </div>
          {status.token ? (
            <div>
              <span className="empty-hint">{t("a2a.endpoint.token")}</span>
              <button
                className="btn ghost sm right"
                onClick={() => void navigator.clipboard?.writeText(status.token ?? "")}
              >
                {t("a2a.endpoint.copy")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="first-run-actions">
        <button
          className={running ? "btn sm" : "btn sm primary"}
          disabled={busy || projectId == null}
          onClick={() => void toggle()}
        >
          {running ? t("a2a.endpoint.close") : t("a2a.endpoint.open")}
        </button>
      </div>
      {error ? <div className="msg-error">{error}</div> : null}
    </div>
  );
}
