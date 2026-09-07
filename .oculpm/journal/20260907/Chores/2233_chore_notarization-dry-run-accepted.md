---
schema_version: 1
type: chore
slug: "notarization-dry-run-accepted"
status: done
difficulty: low
created_at: "2026-09-07T22:33:58+09:00"
session_id: "20260907-003"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "12a04cf3-30bb-4d04-9cee-cc975be14ee7"
language: "ko"
verified_by_user: false
files_touched: []
related:
  - ref: "20260907/Chores/2131_chore_apple-developer-id-signing-notarize.md"
    kind: "followup"
tags:
  - "release"
  - "macos"
  - "notarization"
  - "verification"
  - "mcp-tool"
---
[x] 공증 예행연습이 Accepted 로 통과했다

앞선 일지에서 "시크릿이 없어 서명·공증이 실제로 붙은 번들을 만들어 보지 못했다"고 남겨 둔 구멍을 메웠다. 태그를 태우기 전에 체인 전체를 실증하는 것이 목적이었고, Rust 재빌드 없이 **설치돼 있던 번들의 복사본**을 스크래치패드에서 재서명해 애플 공증 서버까지 왕복시켰다.

## 확인한 것

- 재서명 — 사이드카 `oculpm-mcp` 먼저, 그다음 `.app`. 체인 `Developer ID Application → Developer ID CA → Apple Root`, 타임스탬프 부착, `flags=0x10000(runtime)` 유지
- `codesign --verify --strict --deep` — `valid on disk` · `satisfies its Designated Requirement`
- 공증 제출 → `status: Accepted` (지적사항 0건 — **엔타이틀먼트 없이 통과**한다는 실증)
- `stapler staple` + `validate` 통과
- 최종 `spctl -a -vvv` — `accepted` · `source=Notarized Developer ID`

GitHub 시크릿 6개도 `gh secret list` 로 등록을 확인했다.

## 잡은 문제

바탕화면에 `.p12` 가 두 개 있었고, 그중 하나(1533 bytes)는 **개인 키만 있고 인증서가 없었다**. CI 가 그것을 임포트하면 코드서명 신원을 못 찾아 — 실패가 아니라 조용히 무서명 번들이 나간다. 암호를 모르는 채로도 PKCS#12 의 백 구조로 판별했다: `pkcs8ShroudedKeyBag`(1.2.840.113549.1.12.10.1.2)은 둘 다 있었지만 인증서가 든 `encryptedData`(1.2.840.113549.1.7.6)는 3264 bytes 쪽에만 있었다. 사용자가 올린 것은 정상 파일 쪽으로 확인됐다.

## 검증

위 명령들의 실제 출력으로 확인했다 (제출 id `0ecad5c3`). **아직 실증 못 한 고리 하나**: 예행연습은 키체인의 신원을 직접 썼으므로 CI 경로인 `APPLE_CERTIFICATE` ↔ `APPLE_CERTIFICATE_PASSWORD` 짝은 맞춰본 적이 없다. 파일 내용물은 확인했으니 남은 것은 암호가 그 파일 것이냐 하나이고, 어긋나도 빌드는 실패하지 않으므로 `docs/RELEASE.md` §6 의 `spctl` 확인이 그 그물이다.

## 메모

인증서 유효기간이 `notAfter=2027-02-01` 이다 — Developer ID 는 보통 5년인데 약 5개월로 잘려 있다(발급 CA 자체의 만료에 맞춰진 것으로 보인다). 타임스탬프가 붙은 서명은 만료 뒤에도 계속 유효하므로 이미 나간 빌드는 안전하지만, **2027-02-01 이후 새 빌드를 서명하려면 인증서 갱신이 필요**하다. 이 날짜는 릴리스 문서와 별도로 어딘가 알람이 필요하다.