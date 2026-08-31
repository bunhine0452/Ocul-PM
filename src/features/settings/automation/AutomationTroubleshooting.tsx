// 자동화 문제 해결 3종 — **에디터와 진단이 같은 말을 쓴다** (설계 §2.5).
//
// Osaurus 가 문서에 못박은 절차를 UI 로 옮긴 것이다. 세 증상이 자동화 디버깅의
// 거의 전부인데, 예전 우리 화면은 셋 중 어느 것도 답하지 않았다:
//
//   안 돌았다      → 어디를 봐야 하는지 몰라 "고장났나 보다" 로 끝난다
//   너무 자주 돈다 → 티어를 길게 하면 된다는 걸 모른다
//   결과가 이상하다 → 발동 원장(진단)이 이미 답을 들고 있는데 아무도 안 본다
//
// 문구를 두 벌 들면 곧 갈라진다. 그래서 한 컴포넌트를 두 화면이 렌더한다.

import { useT } from "@/i18n";

export function AutomationTroubleshooting({ compact = false }: { compact?: boolean }) {
  const { t } = useT();
  const rows = [
    { id: "idle", q: t("automation.trouble.idle.q"), a: t("automation.trouble.idle.a") },
    { id: "noisy", q: t("automation.trouble.noisy.q"), a: t("automation.trouble.noisy.a") },
    { id: "wrong", q: t("automation.trouble.wrong.q"), a: t("automation.trouble.wrong.a") },
  ];
  return (
    <div className="rounded-md border border-border/60 bg-accent/10 px-3 py-2 space-y-2">
      {!compact && (
        <p className="text-[11px] font-medium text-foreground">{t("automation.trouble.title")}</p>
      )}
      <ul className="space-y-1.5">
        {rows.map((row) => (
          <li key={row.id} className="text-[11px] leading-relaxed">
            <span className="text-foreground">{row.q}</span>{" "}
            <span className="text-muted-foreground">{row.a}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
