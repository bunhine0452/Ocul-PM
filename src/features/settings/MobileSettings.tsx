// 설정 → 모바일 탭 (.oculpm/planner/mobile-bridge.md #mb0-settings-ui).
//
// 서버 수명(켜기/끄기·주소)·기기 페어링(6자리 코드·QR·카운트다운)·연결 기기
// 목록/해제. 서버 로직은 전부 백엔드(mobile_bridge/) — 여기는 커맨드 6개의
// 얇은 소비자다. 실패 사유(Tailscale 미탐지 등)는 백엔드 문자열을 그대로 보여
// 준다 (플랜 D5 — 탐지 실패는 정상 상태의 하나).
import { useCallback, useEffect, useRef, useState } from "react";
import { renderSVG } from "uqr";

import {
  commands,
  type MobileBridgeStatus,
  type MobileDevice,
  type PairingInfo,
} from "@/lib/bindings";
import { useT } from "@/i18n";

export function MobileSettings({
  Section,
  Field,
}: {
  Section: React.ComponentType<{ title: string; description?: string; children: React.ReactNode }>;
  Field: React.ComponentType<{ label: string; hint?: string; children: React.ReactNode }>;
}) {
  const { t } = useT();

  const [status, setStatus] = useState<MobileBridgeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [pairing, setPairing] = useState<PairingInfo | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [devices, setDevices] = useState<MobileDevice[]>([]);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const [st, dv] = await Promise.all([
      commands.mobileBridgeStatus(),
      commands.mobileBridgeDevices(),
    ]);
    if (st.status === "ok") setStatus(st.data);
    if (dv.status === "ok") setDevices(dv.data);
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [refresh]);

  const running = status?.running ?? false;

  const toggleServer = async () => {
    setBusy(true);
    setStartError(null);
    const res = running ? await commands.mobileBridgeStop() : await commands.mobileBridgeStart();
    setBusy(false);
    if (res.status === "error") {
      setStartError(res.error);
      return;
    }
    setStatus(res.data);
    if (!res.data.running) setPairing(null); // 서버가 꺼지면 페어링 세션도 죽는다.
  };

  const beginPairing = async () => {
    const res = await commands.mobileBridgePairingBegin();
    if (res.status === "error") {
      setStartError(res.error);
      return;
    }
    setPairing(res.data);
    setSecondsLeft(res.data.expires_in_secs);
    if (countdownRef.current) clearInterval(countdownRef.current);
    countdownRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1 && countdownRef.current) clearInterval(countdownRef.current);
        return Math.max(0, s - 1);
      });
    }, 1000);
    // 페어링이 완료되면 기기 목록에 나타난다 — 코드가 사는 동안 주기 폴링.
    void pollDevicesWhilePairing();
  };

  const pollDevicesWhilePairing = async () => {
    const before = devices.length;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const dv = await commands.mobileBridgeDevices();
      if (dv.status !== "ok") continue;
      setDevices(dv.data);
      if (dv.data.length > before) {
        setPairing(null); // 등록 성공 — 코드 카드를 접는다.
        return;
      }
    }
  };

  const revoke = async (id: number) => {
    const res = await commands.mobileBridgeRevokeDevice(id);
    if (res.status === "ok") setDevices(res.data);
  };

  const fmtTime = (iso: string | null) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2">
        <span className="shrink-0 px-1.5 py-0.5 rounded-md text-[10px] font-bold tracking-wide bg-primary/12 text-primary">
          BETA
        </span>
        <p className="text-xs text-muted-foreground leading-relaxed">{t("settings.mobile.betaNote")}</p>
      </div>
      <Section title={t("settings.mobile.serverTitle")} description={t("settings.mobile.serverDesc")}>
        <Field label={running ? t("settings.mobile.running") : t("settings.mobile.stopped")}
          hint={running && status?.addr ? `http://${status.addr}/` : undefined}>
          <button
            onClick={() => void toggleServer()}
            disabled={busy}
            className={`px-3 py-1.5 rounded-md text-[13px] font-medium transition-colors cursor-pointer disabled:opacity-50 ${
              running
                ? "bg-destructive/10 text-destructive hover:bg-destructive/20"
                : "bg-primary/10 text-primary hover:bg-primary/20"
            }`}
          >
            {running ? t("settings.mobile.stop") : t("settings.mobile.start")}
          </button>
        </Field>
        {startError ? (
          <p className="text-xs text-destructive whitespace-pre-wrap">
            {t("settings.mobile.startFailed", { message: startError })}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">{t("settings.mobile.sleepNote")}</p>
      </Section>

      {running ? (
        <Section title={t("settings.mobile.pairTitle")} description={t("settings.mobile.pairDesc")}>
          {pairing && secondsLeft > 0 ? (
            <div className="flex items-start gap-4">
              <div
                aria-hidden
                className="w-28 h-28 shrink-0 rounded-md border border-border bg-white p-1.5"
                // uqr 은 정적 SVG 문자열만 만든다 (외부 입력 없음 — 우리 주소뿐).
                dangerouslySetInnerHTML={{ __html: renderSVG(pairing.url) }}
              />
              <div className="space-y-1.5">
                <div className="text-2xl font-mono tracking-[0.3em] text-foreground">{pairing.code}</div>
                <div className="text-xs font-mono text-muted-foreground">{pairing.url}</div>
                <div className="text-xs text-muted-foreground">
                  {t("settings.mobile.pairCodeHint", { secs: String(secondsLeft) })}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {pairing && secondsLeft === 0 ? (
                <p className="text-xs text-destructive">{t("settings.mobile.pairExpired")}</p>
              ) : null}
              <button
                onClick={() => void beginPairing()}
                className="px-3 py-1.5 rounded-md text-[13px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors cursor-pointer"
              >
                {t("settings.mobile.pairBegin")}
              </button>
            </div>
          )}
        </Section>
      ) : null}

      <Section title={t("settings.mobile.devicesTitle")}>
        {devices.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("settings.mobile.devicesEmpty")}</p>
        ) : (
          <ul className="space-y-2">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
                <div className="min-w-0">
                  <div className="text-[13px] text-foreground truncate">{d.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("settings.mobile.paired", { time: fmtTime(d.created_at) })}
                    {" · "}
                    {t("settings.mobile.lastSeen", { time: fmtTime(d.last_seen_at) })}
                  </div>
                </div>
                <button
                  onClick={() => void revoke(d.id)}
                  className="shrink-0 px-2.5 py-1 rounded-md text-xs font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors cursor-pointer"
                >
                  {t("settings.mobile.revoke")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
