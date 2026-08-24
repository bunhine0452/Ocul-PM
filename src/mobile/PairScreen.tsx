// 폰 최초 방문 — 6자리 코드로 토큰 발급 (#mb3-tabs ↔ 백엔드 /pair).
import { useState } from "react";

import { useT } from "@/i18n";
import { setToken } from "@/lib/transport/http";

export function PairScreen({ onPaired }: { onPaired: () => void }) {
  const { t } = useT();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (code.trim().length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/pair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: code.trim(), name: name.trim() || defaultDeviceName() }),
      });
      const json = (await res.json()) as { token?: string; error?: string };
      if (!res.ok || !json.token) {
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setToken(json.token);
      onPaired();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mob-root min-h-dvh flex flex-col items-center justify-center gap-6 px-8">
      <div className="text-center space-y-3">
        <img src="/icon.svg" alt="Ocul-PM" className="w-14 h-14 mx-auto rounded-2xl" />
        <div className="space-y-1.5">
          <h1 className="text-xl font-semibold">{t("mobile.pair.title")}</h1>
          <p className="text-sm mob-text-2">{t("mobile.pair.desc")}</p>
        </div>
      </div>
      <div className="w-full max-w-xs space-y-3">
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          aria-label={t("mobile.pair.codeLabel")}
          className="mob-input w-full text-center text-3xl font-mono tracking-[0.4em] px-4 py-3"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("mobile.pair.nameLabel")}
          aria-label={t("mobile.pair.nameLabel")}
          className="mob-input w-full px-4 py-2.5 text-sm"
        />
        <button
          onClick={() => void submit()}
          disabled={code.trim().length !== 6 || busy}
          className="mob-btn-primary w-full py-3 text-sm font-semibold"
        >
          {t("mobile.pair.submit")}
        </button>
        {error ? (
          <p className="text-xs mob-danger text-center whitespace-pre-wrap">
            {t("mobile.pair.failed", { message: error })}
          </p>
        ) : null}
        <p className="text-[11px] mob-text-3 text-center leading-relaxed">
          {t("mobile.pair.sleepHint")}
        </p>
      </div>
    </div>
  );
}

function defaultDeviceName(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  return "mobile";
}
