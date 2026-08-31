# 06 — 랜딩 표면

> Phase 8 · 상위: [00-master-plan.md](00-master-plan.md)

## 0. 현재 상태

`landing/` 은 단일 정적 사이트입니다 (git 연동 없음 — `cd landing && vercel --prod`).
페이지: `index.html`(543줄) · `keynote.html` · `plugin.html` · `wiki/`(ko/en 17면).
`sitemap.xml` 은 이 구조를 반영합니다.

Osaurus 는 같은 카테고리에서 훨씬 넓은 표면을 갖고 있습니다:
`/blog`(6편) · `/guides`(3편 + 비디오 4편) · `/models` · `/which-model` ·
`/changelog`(**changefreq daily**) · `/skills`(18개 카탈로그) · `/themes` ·
`/brand` · `/about` · `/why-osaurus`(priority 0.9) · `/why-free` · `/media` ·
`/credits` · docs 서브도메인(Docusaurus, 55면).

우리에게 없고 **싸고 효과가 큰** 것만 고릅니다.

## 1. `/changelog` — 거의 공짜

`CHANGELOG.md` 가 이미 GitHub 릴리스 노트의 유일한 소스입니다
(`docs/RELEASE.md`). 그걸 렌더하는 정적 페이지를 하나 두면:

- sitemap 에 **`changefreq: daily`** 짜리 페이지가 생깁니다 (SEO)
- "이 앱이 살아 있는가" 라는 첫 질문에 즉답합니다
- 앱 안 업데이트 탭이 GitHub API 로 가져오던 과거 패치노트와 **같은 내용**이
  웹에도 있게 됩니다

구현: 빌드 스크립트가 `CHANGELOG.md` → `landing/changelog.html` 로 변환.
릴리스 절차에 한 줄 추가 (5면 체크리스트의 landing 면 안에서 처리).

버전 앵커(`#v2-26-0`)를 달아 릴리스 노트에서 웹으로 링크할 수 있게 합니다.

## 2. `/themes` — Phase 4 의 배포 표면

[03-themes.md](03-themes.md) 가 테마를 JSON 파일로 만듭니다. 그러면 갤러리
페이지가 성립합니다.

카드 하나당: 이름 · 작성자 · 라이트/다크 미리보기 스와치 · **설치 버튼**
(`oculpm://theme/install?url=…` — [05](05-config-plugins-import.md) §4).

내장 5종 + 커뮤니티 기여분. 기여는 PR 로 받습니다 (`landing/themes/*.json`).

## 3. `/skills` — `plugin.html` 을 카탈로그로

`plugin.html` 은 이미 플러그인 문서 페이지이고, `plugin_docs_sync.test.ts` · `plugin_skills_sync.test.ts` 가
커맨드/도구/스킬 누락을 게이트로 막고 있습니다. 이걸 **Osaurus 형 카탈로그**로
확장합니다.

항목당: 이름 · 버전 pill · 한 줄 설명 · GitHub 링크 · **설치 버튼**
(`oculpm://skill/install?…`). 지금은 웹에서 앱으로 오는 길이 없어 사용자가
직접 파일을 만들어야 합니다.

기존 게이트 테스트를 확장해 카탈로그 항목 누락도 잡습니다.

## 4. `/privacy` — "무엇을 절대 보내지 않는가"

[D6](00-master-plan.md#decision-6): 텔레메트리는 도입하지 않지만 **서술 방식**은
가져옵니다.

Osaurus 는 정확히 무엇을 보내고 무엇을 절대 안 보내는지(대화·프롬프트·출력·키)를
목록으로 못박고, 로컬 빌드는 API 키가 없어 아예 초기화되지 않는다고 씁니다.

ocul-pm 은 "전부 로컬" 을 **주장만** 하고 목록으로 못박은 곳이 없습니다. 실제로
나가는 것은 셋뿐입니다:

| 나가는 것 | 언제 | 어디로 |
|---|---|---|
| LLM 요청 본문 | 사용자가 AI 를 쓸 때 · 자동화가 돌 때 | 사용자가 고른 프로바이더 |
| 업데이트 확인 | 앱 시작 · 수동 확인 | GitHub releases |
| GitHub 조회 | 패치노트·플러그인 임포트 | GitHub API |

그리고 **절대 안 나가는 것**: 일지 본문(사용자가 AI 에 물을 때 제외) · `.oculpm/`
파일 · 소스 코드(RAG 로 고른 스니펫 제외) · API 키(OS 키체인) · 사용 통계
(**수집 안 함**) · 크래시 리포트(**수집 안 함**).

자동화가 배경에서 LLM 을 부르게 되므로(Phase 1·2) 이 페이지는 **선택이 아니라
필수**입니다.

## 5. `/automation` 가이드

Osaurus 의 `/guides` 3편은 전부 "2분 안에 되는 것" 을 보여주는 짧은 글입니다.
우리도 Phase 1·2 를 파는 가이드 한 편을 씁니다:

> **손이 멎으면 기록됩니다 — ocul-pm 자동화 2분 설정**
> 배경 모델 고르기 → 주간 요약 스케줄 켜기 → 감시 티어 고르기.
> 무엇이 과금되는지, 무엇이 안 나가는지 명시.

위키(`landing/wiki-src/`)에 ko/en 양쪽으로 넣습니다 — 기존 위키가 이미 hreflang
쌍을 sitemap 에 갖고 있어 구조가 준비돼 있습니다.

## 6. 하지 않는 것

| 안 함 | 이유 |
|---|---|
| `/blog` | 유지 비용. 쓸 게 쌓이면 그때 |
| 다운로드 수·스타 수 실시간 배지 | 지금 숫자가 설득력을 만들지 않음 |
| 미디어 로고 벽 | 없는 것을 흉내내는 꼴 |
| docs 서브도메인(Docusaurus) | 위키 17면이 이미 그 역할. 이원화는 부채 |

## 7. 릴리스 절차 반영

`docs/RELEASE.md` 의 5면 중 landing 면에 항목이 늘어납니다:

1. `index.html` 버전 문자열 5곳 + JSON-LD `featureList` / FAQ / bento
2. **`changelog.html` 재생성** (신규)
3. `sitemap.xml` 에 신규 URL + `lastmod` 갱신
4. `themes/` · 스킬 카탈로그에 신규 항목이 있으면 반영
5. `cd landing && vercel --prod`

`docs/RELEASE.md` 를 이 라운드에서 함께 갱신합니다 — 절차 문서가 뒤처지면
다음 릴리스에서 조용히 빠집니다.
