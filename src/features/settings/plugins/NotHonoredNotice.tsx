/**
 * 「선언됐지만 아직 이행하지 않음」 (Osaurus 라운드 Phase 6 `#not-honored-notice`).
 *
 * 이 라운드가 Osaurus 에서 가장 잘 가져온 UX 다. 우리가 다루지 않는 것을
 * **조용히 무시하지 않고** 목록으로 적는다 — "놀라지 않게".
 *
 * 번들 임포트에만 두지 않고 일반화한다: 같은 컴포넌트를 세 자리가 쓴다.
 *
 * | 자리 | 무엇을 적는가 |
 * |---|---|
 * | 플러그인 상세 | 감지했지만 실행하지 않는 아티팩트 (`hooks/`·`bin/` …) |
 * | AGENTS.md 템플릿 | 템플릿이 요구하지만 이 앱 버전이 아직 모르는 필드 |
 * | 자동화 에디터 | 이 빈도·티어에서 지원하지 않는 옵션 |
 *
 * 정직성 감사(honesty-audit)의 UI 판이다 — "했다고 말한 것" 과 "실제로 되는
 * 것" 의 차이를 화면에 남긴다.
 */

import { AlertTriangle } from "@/components/Icons";
import { useT, type I18nKey } from "@/i18n";

export interface NotHonoredItem {
  /** 목록에 뜨는 이름 (`hooks` · `lspServers` · 옵션 이름). */
  name: string;
  /** 사유 코드 — i18n 키 `notHonored.reason.<code>` 로 바뀐다. */
  reason: string | null;
}

/** 모르는 사유 코드도 키를 만들어 넘긴다 — `t` 가 키를 그대로 돌려주므로
 *  화면에 코드가 뜨고, 조용히 사라지지 않는다. */
export function notHonoredReasonKey(reason: string | null): I18nKey {
  return `notHonored.reason.${reason ?? "unknown"}` as I18nKey;
}

export function NotHonoredNotice({
  items,
  titleKey,
}: {
  items: NotHonoredItem[];
  /** 자리마다 다른 머리말. 없으면 공통 문구. */
  titleKey?: I18nKey;
}) {
  const { t } = useT();
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
        {t(titleKey ?? "notHonored.title")}
      </p>
      <ul className="space-y-1">
        {items.map((item) => (
          <li key={item.name} className="text-xs text-muted-foreground">
            <span className="font-mono text-foreground">{item.name}</span>
            {" — "}
            {t(notHonoredReasonKey(item.reason))}
          </li>
        ))}
      </ul>
    </div>
  );
}
