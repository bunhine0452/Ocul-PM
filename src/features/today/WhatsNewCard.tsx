import { useEffect, useState } from "react";
import { Download, X } from "@/components/Icons";
import { Markdown } from "@/components/Markdown";
import { isNewerVersion } from "@/components/UpdateBanner";
import { useOptionalSettings } from "@/contexts/SettingsContext";
import { useT } from "@/i18n";
import { commands } from "@/lib/bindings";
import { openSettings } from "@/lib/settingsNav";
import { RELEASES_API, releaseHighlights } from "@/lib/updater";

// 업데이트 뒤 1회 What's-new 카드 (완성도 라운드 Phase 2, 2026-08-30).
//
// 자동 업데이트는 조용히 재시작한다 — 사용자는 무엇이 달라졌는지 설정 →
// 업데이트까지 가야 알았다. 마지막으로 본 버전을 SQLite 설정
// (`last_seen_version`, 창을 여러 개 띄워도 한 값) 에 두고, 앱 버전이 그보다
// 새로우면 Today 맨 위에 그 버전의 릴리스 노트를 한 번 보여 준다.
//
// 처음 설치(기록 없음)엔 보이지 않고 조용히 현재 버전을 적는다 — 방금 깐
// 사람에게 "업데이트됐어요" 는 거짓말이다.

type Notes = { kind: "loading" } | { kind: "ready"; md: string } | { kind: "unavailable" };

export function WhatsNewCard() {
  const { t } = useT();
  const settings = useOptionalSettings();
  const [version, setVersion] = useState<string | null>(null);
  const [notes, setNotes] = useState<Notes>({ kind: "loading" });
  const loaded = settings?.loaded ?? false;
  const lastSeen = settings?.settings.lastSeenVersion ?? "";
  const set = settings?.set;

  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    void commands.appInfo().then((res) => {
      if (!cancelled && res.status === "ok") setVersion(res.data.version);
    });
    return () => {
      cancelled = true;
    };
  }, [loaded]);

  const show = version != null && lastSeen !== "" && isNewerVersion(version, lastSeen);

  // 기록이 없거나(첫 설치) 기록이 더 새로우면(다운그레이드) 조용히 맞춘다.
  useEffect(() => {
    if (!loaded || version == null || !set) return;
    if (lastSeen === "" || (lastSeen !== version && !isNewerVersion(version, lastSeen))) {
      void set("lastSeenVersion", version);
    }
  }, [loaded, version, lastSeen, set]);

  useEffect(() => {
    if (!show || version == null) return;
    let cancelled = false;
    fetch(RELEASES_API, { headers: { Accept: "application/vnd.github+json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: unknown) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        const hit = list.find((r) => {
          const tag = String(r?.tag_name ?? r?.name ?? "");
          return tag === `v${version}` || tag === version;
        });
        const md = hit?.body ? releaseHighlights(String(hit.body)) : "";
        setNotes(md ? { kind: "ready", md } : { kind: "unavailable" });
      })
      .catch(() => {
        if (!cancelled) setNotes({ kind: "unavailable" });
      });
    return () => {
      cancelled = true;
    };
  }, [show, version]);

  if (!show || version == null || !set) return null;
  const dismiss = () => void set("lastSeenVersion", version);

  return (
    <div className="card card-pad whats-new-card" role="status" style={{ marginBottom: 16 }}>
      <div className="stat-top">
        <Download size={15} color="var(--accent-text)" />
        <strong>{t("today.whatsNew.title", { version })}</strong>
        <button className="btn ghost sm right" onClick={dismiss} aria-label={t("common.dismiss")}>
          <X size={13} />
        </button>
      </div>
      <div className="whats-new-body">
        {notes.kind === "loading" ? (
          <span className="empty-hint">{t("today.whatsNew.loading")}</span>
        ) : notes.kind === "ready" ? (
          <Markdown>{notes.md}</Markdown>
        ) : (
          <span className="empty-hint">{t("today.whatsNew.unavailable")}</span>
        )}
      </div>
      <div className="first-run-actions">
        <button
          className="btn sm"
          onClick={() => {
            dismiss();
            openSettings("update");
          }}
        >
          {t("today.whatsNew.full")}
        </button>
      </div>
    </div>
  );
}
