import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Download, X } from "@/components/Icons";
import { useT } from "@/i18n";
import { requestReindex } from "@/lib/projectActions";

// First-run embedding-model download progress. The Rust `Embedder` emits
// `embedding-model-download` events (start / progress / done / error) the first
// time semantic indexing or search triggers the model download (~135MB, once).
// Without this the first index just looks frozen — fastembed's own progress only
// goes to stdout, which a packaged app never shows.

type Progress = {
  status: "start" | "progress" | "done" | "error";
  downloaded: number;
  total: number;
};

const mb = (n: number) => (n / (1024 * 1024)).toFixed(0);

export function EmbeddingModelBanner() {
  const { t } = useT();
  const [p, setP] = useState<Progress | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<Progress>("embedding-model-download", (e) => {
      const d = e.payload;
      setP(d);
      if (d.status === "done") {
        // brief "준비 완료" flash, then dismiss.
        setTimeout(() => setP((cur) => (cur?.status === "done" ? null : cur)), 1800);
      }
    }).then((u) => {
      unlisten = u;
    });
    return () => unlisten?.();
  }, []);

  if (!p) return null;

  const pct = p.total > 0 ? Math.min(99, Math.round((p.downloaded / p.total) * 100)) : 0;
  // 실패 배너는 닫거나 다시 받을 수 있어야 한다 (완성도 라운드 Phase 2) — 예전엔
  // 붉은 줄이 세션 내내 남았고, "다시 시도" 는 문구뿐이었다. 다시 받기 = 색인을
  // 다시 돌리는 것: 임베더는 첫 사용 때 모델을 받는다.
  const retry = () => {
    setP(null);
    requestReindex();
  };

  return (
    <div className="update-banner" role="status" aria-live="polite">
      <Download size={16} />
      <div className="update-banner-text">
        {p.status === "error" ? (
          <>{t("embed.failed")}</>
        ) : p.status === "done" ? (
          <>{t("embed.ready")}</>
        ) : (
          <>
            {t("embed.downloading")} <b>{pct}%</b>
            <div className="dl-progress">
              <div className="dl-progress-bar" style={{ width: `${pct}%` }} />
            </div>
            <span className="dl-sub">
              {mb(p.downloaded)} / ~{mb(p.total)} MB · {t("embed.onceOnly")}
            </span>
          </>
        )}
      </div>
      {p.status === "error" ? (
        <button type="button" className="update-banner-cta" onClick={retry}>
          {t("embed.retry")}
        </button>
      ) : null}
      {p.status === "error" || p.status === "done" ? (
        <button
          type="button"
          className="update-banner-x"
          onClick={() => setP(null)}
          aria-label={t("common.dismiss")}
        >
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}
