---
schema_version: 1
type: chore
slug: "verify-shipped-dmg-notarized"
status: done
difficulty: verylow
created_at: "2026-09-08T00:41:34+09:00"
session_id: "20260908-001"
agent:
  id: "claude-code"
  version: "Opus 5"
  session: "12a04cf3-30bb-4d04-9cee-cc975be14ee7"
language: "ko"
verified_by_user: false
files_touched: []
related:
  - ref: "20260908/Chores/0001_chore_release-v2-45-0-signed-notarized.md"
    kind: "followup"
tags:
  - "release"
  - "macos"
  - "notarization"
  - "verification"
  - "mcp-tool"
---
[x] 출시된 .dmg 가 공증본임을 확인했다

앞선 릴리스 일지가 "CI 가 구운 번들에서도 되는지는 이 빌드가 처음 실증한다"고 열어 둔 것을 닫는다. 예행연습은 로컬 키체인의 신원을 직접 썼으므로, CI 경로(`APPLE_CERTIFICATE` 를 임시 키체인에 임포트 → `APPLE_CERTIFICATE_PASSWORD` 로 풀기)는 검증된 적이 없었다. 이 짝이 어긋나면 빌드는 초록으로 끝나면서 무서명 번들을 내놓는다.

## 확인

`docs/RELEASE.md` §6 절차 그대로 — 릴리스 에셋을 내려받아 마운트하고 읽었다.

- `run=success` · `job=success` (취소 run 도 exit 0 이므로 conclusion 필드로 판정)
- 에셋 4개: `.dmg`(29.2MB) · `.app.tar.gz` · `.sig` · `latest.json`
- `codesign` — `Developer ID Application: Hyunbin Kim (BP57Z7L498)` → `Developer ID CA` → `Apple Root CA`, `TeamIdentifier=BP57Z7L498`, `flags=0x10000(runtime)`
- `spctl -a -vvv -t exec` — `accepted` · **`source=Notarized Developer ID`**
- `xcrun stapler validate` — 통과 (오프라인에서도 열린다)

## 검증

위 명령의 실제 출력이 근거다. 이제 사용자는 `.dmg` 를 받아 `Applications` 로 끌어다 놓고 그냥 열 수 있고, README·랜딩 FAQ 에 적은 「경고 없이 열립니다」가 참이 됐다 — 그 문구들이 릴리스 전까지 앞서 있던 상태도 이로써 해소됐다.