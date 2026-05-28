# 06. 1.0 배포 계획 — 번들, 서명, 채널, 브랜딩

> 본 문서의 위상: Lite-W6 의 Phase D (PR12) 와 그 직전 결정 항목.
> Lite-W6 의 모든 코드 변경이 ✅ 된 시점에 실행.

---

## 0. 배포 전 잠금

배포 직전 다음이 *모두* ✅ 인 상태에서만 진입:

- [ ] [`00-master-plan.md`](./00-master-plan.md) §7 의 성공 지표 7개 모두 측정 & 통과.
- [ ] [`07-implementation-checklist.md`](./07-implementation-checklist.md) 의 *모든* PR DoD ✅.
- [ ] Dogfooding 회고 + 성능 결과 문서 둘 다 작성.
- [ ] `git status` clean. 머지되지 않은 변경 없음.
- [ ] 로컬에서 macOS dmg + (가능 시) Windows msi 빌드 성공 + 실행 확인.
- [ ] CHANGELOG.md (1.0 변경 요약) 작성.

---

## 1. 배포 형태

### 1.1 1.0 의 채택 형태

| 항목 | 1.0 | 1.1 이후 |
|---|---|---|
| 다운로드 | GitHub Releases 의 *직접 dmg/msi 다운로드* | 동일 + *자체 사이트* |
| 자동 업데이트 | ❌ (수동 재다운로드) | ✅ `tauri-plugin-updater` |
| 코드 서명 | macOS: ad-hoc / Apple Developer ID 둘 중 택 1 (§2.2). Windows: 서명 없음 (SmartScreen 경고) | 둘 다 정식 서명. EV cert 검토. |
| 공증 (notarization) | macOS: Developer ID 시 공증, ad-hoc 시 미공증 | 항상 공증 |
| 플랫폼 | macOS arm64 + Intel · Windows x86_64 | + Linux (deb/AppImage) |
| 백엔드 인프라 | 없음 (전부 로컬) | 없음 (정체성 유지) |

**1.0 은 *직접 다운로드 + 수동 업그레이드 모델*.** 개인 도구이고 사용자 풀이 작기 때문에 자동 업데이트 인프라의 비용을 미룬다.

### 1.2 *대상* 사용자

- 본인 (작성자) 1명.
- 가능하면 외부 dogfooder 1~3명 (베타).
- 일반 배포 (대규모) 는 1.0 의 대상 아님.

---

## 2. 코드 서명 결정

### 2.1 macOS

**Apple Developer Program 가입 여부에 따라 분기**:

- **가입 ✅** ($99/년): Developer ID Application + Installer cert → *정식 서명 + 공증*. Gatekeeper 통과. *권장*.
- **가입 ❌**: ad-hoc 서명만. 사용자가 *우클릭 → 열기* 또는 *시스템 설정 → 보안* 에서 차단 해제 필요. **1.0 에 한해 수용 가능** (사용자 풀 작음).

**결정 권장**: Developer Program 가입. 비용 회수는 *사용자 신뢰* 형태로 즉시.

### 2.2 Windows

- **EV cert** (~$200~400/년): SmartScreen 즉시 통과.
- **OV cert** (~$70~150/년): SmartScreen 평판 누적 후 통과.
- **서명 없음**: SmartScreen "Unknown publisher" 경고. *1.0 에 한해 수용 가능*.

**1.0 결정 권장**: 서명 없음 (Windows 사용자 우선순위 낮음). 1.1 에서 OV cert 도입.

---

## 3. 번들 절차

### 3.1 빌드 명령

```bash
# macOS arm64
pnpm tauri build --target aarch64-apple-darwin

# macOS x86_64 (Intel)
pnpm tauri build --target x86_64-apple-darwin

# Universal binary (택1)
pnpm tauri build --target universal-apple-darwin

# Windows x86_64
pnpm tauri build --target x86_64-pc-windows-msvc
```

**`tauri.conf.json` 확인 항목**:
- `productName`: `Ocul-PM` (또는 `ai-pm` — §6.1 의 *앱 이름 통일* 결정).
- `version`: `1.0.0`.
- `identifier`: `com.ocul-pm.app` (또는 사용자 도메인).
- `bundle.targets`: macOS 는 `["dmg", "app"]`, Windows 는 `["msi", "nsis"]`.
- `bundle.macOS.signingIdentity`: Developer ID 시 채움. ad-hoc 시 `"-"`.
- `bundle.macOS.providerShortName`: Apple ID team short name.
- `bundle.macOS.entitlements`: 신규 — Camera/Microphone 등 필요 권한 *없음* 으로 명시.

### 3.2 공증 (macOS, Developer Program 가입 시)

```bash
xcrun notarytool submit src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/*.dmg \
  --apple-id "$APPLE_ID" \
  --password "$APP_PASSWORD" \
  --team-id "$TEAM_ID" \
  --wait

xcrun stapler staple src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/*.dmg
```

비밀번호는 *app-specific password* (Apple ID 설정에서 발급).

### 3.3 산출물 크기 목표

| 플랫폼 | 목표 |
|---|---|
| macOS arm64 dmg | < 60MB |
| macOS x86_64 dmg | < 65MB |
| macOS universal dmg | < 110MB |
| Windows msi | < 70MB |

리덕션 기법:
- `tauri.conf.json` 의 `tauri.bundle.targets` 에서 불필요한 포맷 제외.
- `Cargo.toml` 의 `[profile.release]`: `lto = true`, `codegen-units = 1`, `strip = true`, `opt-level = "z"` (크기 우선) 또는 `"3"` (속도 우선) 중 택. **1.0 은 `opt-level = "z"`**.
- vite build 의 `manualChunks` 로 vendor 분리 + tree-shake 강화.
- `tauri.conf.json` 의 `bundle.resources` 의 불필요 항목 제거.

---

## 4. 릴리스 노트

### 4.1 위치

- `docs/release-notes-1.0.md` (신규).
- GitHub Releases 의 본문 (위 파일을 복붙).

### 4.2 양식 (한국어 우선)

```markdown
# Ocul-PM 1.0 — Lite 마스터링 출시

릴리스 일자: YYYY-MM-DD

## TL;DR

- `.oculpm/` 가 변화 추적의 단일 출처.
- 외부 코딩 에이전트와 함께 쓰는 *PM-Lite* 도구로 정체성 확정.
- 자체 코드 에디터 / Changelog 화면 / Session 추정 UI 제거.
- 로컬 diff 뷰어 + 유연한 도크 레이아웃 신설.

## 새 기능

### 로컬 diff 뷰어
변경된 파일에 부분 reindex 를 실행하고, 그 결과를 사이드 패널의 unified/side-by-side diff 로 표시한다.
git 저장소와 비-git 저장소 모두 지원 (snapshot 폴백).

### 유연한 레이아웃
3 모드 (Today only / Today+Terminal split / Terminal only) 가 ⌘J 와 ⌘⇧J 로 즉시 전환.
AI 패널은 오버레이 + 분리 윈도우 둘 다 지원.

### File Tree 변경 하이라이트
워처가 본 변경 파일이 트리에 dot 으로 표시. 클릭 시 diff 진입.

### 외부 에디터 진입
파일 클릭 시 사용자가 지정한 외부 에디터 명령 (`code "%path"` 등) 으로 즉시 열린다.

## 제거된 기능

| 무엇이 | 왜 |
|---|---|
| SQLite Changelog 시스템 | `.oculpm/journal/` 이 단일 출처가 됨. 이미 W5 의 MigrationModal 로 이주 가능. |
| 자체 CodeEditor | 외부 코딩 에이전트가 편집 담당. legacy 폴더로 보존. |
| Problems 탭 | 동작 안 하는 placeholder 였음. |
| Session 비교 모달 (DiffVsNarrative) | 외부 LLM 의 실제 세션 경계와 어긋남. 로컬 diff 뷰어가 검증 경로 대체. |
| Dependency Graph 의 메인 진입 | Overview drawer 로 강등 (또는 완전 제거 — 결정에 따라). |

## 호환성

- v0.x DB → 1.0 진입 시 MigrationModal 이 1회 안내. 이주 후 invisible.
- 워크스페이스 영속화 (`aipm:workspace:v1`) 는 자동 마이그레이션.
- `.oculpm/` 의 `schema_version = 1` 로 잠금.

## 알려진 한계

- 자동 업데이트 미지원 (수동 재다운로드).
- macOS Developer ID 미서명 빌드는 *우클릭 → 열기* 필요.
- Windows 미서명 빌드는 SmartScreen 경고.

## 다음 라운드 (1.1+)

- 자동 업데이트
- Windows OV cert
- 외부 LLM 도구 자동 라벨링 (clipboard / 단축키 hook)
- LSP-기반 Problems 패널 재도입 (필요 시)
- 다중 파일 동시 diff
- 읽음 표시 UI (변경 하이라이트 fade)

## 참고

- 본 라운드의 설계 문서: `docs/Lite-update/`
- 회고: `docs/Lite-update/_dogfooding-retrospective.md`
- 성능 측정: `docs/Lite-update/_perf-1.0.md`
```

---

## 5. GitHub Releases

### 5.1 태그 / 브랜치

- 머지 후 `main` 에서 직접 태그 `v1.0.0`.
- 브랜치 보호: `main` 에 force-push 금지.
- 태그는 *GPG 서명* 권장 — `git tag -s v1.0.0 -m "Ocul-PM 1.0 — Lite"`.

### 5.2 Release 생성

```bash
gh release create v1.0.0 \
  --title "Ocul-PM 1.0 — Lite 마스터링 출시" \
  --notes-file docs/release-notes-1.0.md \
  src-tauri/target/aarch64-apple-darwin/release/bundle/dmg/Ocul-PM_1.0.0_aarch64.dmg \
  src-tauri/target/x86_64-apple-darwin/release/bundle/dmg/Ocul-PM_1.0.0_x64.dmg \
  src-tauri/target/x86_64-pc-windows-msvc/release/bundle/msi/Ocul-PM_1.0.0_x64_en-US.msi
```

### 5.3 GitHub Actions (선택)

릴리스 자동화는 *1.1 이후*. 1.0 은 *로컬 빌드 + 수동 업로드* — 사용자 풀이 작아 자동화 비용 회수 어려움.

대신 *체크리스트 스크립트* 만 작성:

```bash
# scripts/release-1.0.sh
set -e
echo "1. typecheck"; pnpm typecheck
echo "2. lint";       pnpm lint
echo "3. test";       pnpm test
echo "4. cargo test"; (cd src-tauri && cargo test)
echo "5. cargo clippy"; (cd src-tauri && cargo clippy -- -D warnings)
echo "6. build mac arm64"; pnpm tauri build --target aarch64-apple-darwin
echo "7. build mac x86_64"; pnpm tauri build --target x86_64-apple-darwin
echo "8. (manual) windows build via parallels/vm or skip"
echo "9. notarize (if Developer ID set)"
echo "10. gh release create v1.0.0 ..."
```

---

## 6. 브랜딩

### 6.1 앱 이름 통일 (미해결 결정 D)

후보:
- **`Ocul-PM`** — README/MigrationModal/Watcher event prefix 에 자주 등장.
- **`ai-pm`** — repo 이름, package.json `name`.

**1.0 결정 권장: `Ocul-PM`**. 이유:
- `.oculpm/` 디렉토리 이름과 정합.
- "ai-pm" 은 generic 한 단어로 검색 노이즈가 큼.
- 향후 v2 가 *멀티 플랫폼* 으로 확장될 때 도메인 이름 (`ocul-pm.app`) 확보 가능.

대체 시 변경 파일:
- `package.json` (`name`)
- `tauri.conf.json` (`productName`)
- `Cargo.toml` (`[package].name`)
- `src/components/TitleBar.tsx` 의 표시명
- `README.md`

### 6.2 아이콘

- `src-tauri/icons/` 의 기존 아이콘 그대로 사용.
- 1.0 안에 새 아이콘 디자인은 *별도 PR* 로 (필수 아님).

### 6.3 폰트 / 컬러

`docs/refactor/MASTER-GUIDE.md §6.4` 의 토큰 그대로. 1.0 안에 변경 없음.

---

## 7. 사용자 README (배포용)

`README.md` (repo 루트) — 현재 9 bytes (`Ocul-PM\n`). 1.0 출시 시 *5분 onboarding 가이드* 로 확장:

```markdown
# Ocul-PM

> 외부 코딩 에이전트와 함께 쓰는 PM-Lite 데스크톱 도구.

## 빠른 시작

1. [Releases](https://github.com/<user>/ai-pm/releases/latest) 에서 dmg/msi 다운로드.
2. macOS: 우클릭 → 열기 (서명 안 된 빌드인 경우).
3. 처음 실행 시 Settings 에서 LLM provider 키 등록.
4. "+ 프로젝트 폴더 추가" → 디렉토리 선택 → 자동 인덱싱.
5. Today 화면에서 *변경된 파일* 카드를 확인 / *AI 오버레이* (⌘\\) 호출.

## 외부 에이전트 연동 (5분)

1. Settings → ocul-pm 탭 → "에이전트 감지" 클릭.
2. 사용 중인 에이전트 (Claude Code / Cursor / Gemini CLI) 활성화.
3. "지금 동기화" → `.claude/CLAUDE.md` / `.cursor/rules/` / `GEMINI.md` 에 마스터 템플릿 자동 주입.
4. 외부 에이전트에 작업 부탁 → `.oculpm/journal/<오늘>/...md` 가 자동 생성됨.

## 단축키

(§3 단축키 매핑 참조)

## 문제 해결

- "외부 LLM 이 journal 을 안 써요" → `.claude/CLAUDE.md` 의 ocul-pm 블록이 존재하는지 확인. 없으면 *에이전트 감지 → 동기화* 다시.
- "Watcher 가 변경을 감지 못해요" → Settings → ocul-pm 탭 → "Watcher 재시작".
- "MigrationModal 이 자꾸 떠요" → "나중에" 가 아닌 *Skip* 또는 *Migrate* 둘 중 선택.

## 라이선스

(추가 결정 필요)
```

---

## 8. 출시 후 운영

### 8.1 핫픽스 정책

- Critical 버그 (앱 진입 불가, 데이터 손상) → 24h 안에 v1.0.1.
- High → 1주 안에 v1.0.x.
- Medium/Low → 1.1 로 묶음.

### 8.2 dogfood 채널

- 본인 + 외부 베타 (선택) → `.oculpm/journal/` 자체가 텔레메트리 대체.
- 자발적 issue 제출만. 자동 텔레메트리는 1.0 에 *없음* (개인 도구).

### 8.3 다음 라운드 시작

- `docs/major_update/oculpm-v1.1/` 또는 `docs/Lite-update-v1.1/` 폴더 신설.
- 본 폴더 (`Lite-update/`) 는 *history 로 보존*. 갱신 없음.

---

## 9. 리스크

| ID | 리스크 | 영향 | 가능성 | 대응 |
|---|---|---|---|---|
| L1 | macOS 미서명 빌드를 사용자가 *실행 못 함* | 높 | 중 | Developer ID 가입 권장. ad-hoc 인 경우 README 의 *우클릭 → 열기* 안내. |
| L2 | Windows 미서명이 SmartScreen 차단 | 중 | 높 | README 의 *추가 정보 → 실행* 안내. |
| L3 | universal binary 크기가 100MB 초과 | 중 | 낮 | arm64 + x86_64 분리 dmg 로 대체. |
| L4 | dogfood 미진행 상태로 출시 후 critical bug | 높 | 중 | Phase D PR11 의 25 시나리오 통합 테스트 + Lite 라운드 dogfood 1주 이상 의무. |
| L5 | 외부 사용자 — *MigrationModal 이 자동 진입 안 함* | 중 | 낮 | `migration.dismissed` 의 *영구* 보존 안 됨을 확인. 사용자가 *나중에* 클릭한 후 Settings 에서 재진입 가능해야 함. |
| L6 | 앱 이름 통일 누락 — 코드/문서 혼재 | 낮 | 중 | §6.1 결정 후 1차 grep + 일괄 치환 PR. |

---

## 10. 출시일 결정

권장 시퀀스:
1. **D-14**: Lite-W6 Phase A + B 완료.
2. **D-7**: Lite-W6 Phase C 완료, Phase D PR10 (a11y) 진입.
3. **D-3**: Phase D PR11 (성능 + 통합 테스트) green.
4. **D-1**: 빌드 + 공증 + 릴리스 노트 + README 검토.
5. **D-day**: `gh release create v1.0.0`.

긴급 회귀 발생 시 *D-day 를 미루는 것이 정상*. *주말 출시 금지* (즉시 핫픽스 환경 부재).
