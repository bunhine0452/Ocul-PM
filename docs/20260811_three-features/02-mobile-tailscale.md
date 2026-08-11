# 02 — Tailscale 모바일 연동 (읽기 전용)

> [00-master-plan.md](00-master-plan.md) Phase 3 · 예상 ~7일 · 목표 릴리스 v2.11.0

## 1. 무엇을 만드는가

앱 프로세스 안에 작은 HTTP 서버를 띄우고, **Tailscale 인터페이스에만** 바인딩해서, 같은 tailnet 의 폰에서 일지·플래너·오늘 브리핑을 읽습니다.

```
   [맥북 — Ocul-PM 실행 중]                          [폰 — 같은 tailnet]
   ┌────────────────────────────────┐
   │ Tauri 프로세스                  │
   │  ├ 창들 (main / project-*)      │
   │  ├ OculpmManager ── redaction ──┼──┐
   │  ├ Db (SQLite 캐시)             │  │
   │  └ axum 서버                    │  │      Safari
   │     bind 100.73.187.123:7777 ───┼──┴───▶  http://kimhyunbin-macbookpro
   └────────────────────────────────┘             .tail2a2edb.ts.net:7777
              │                                       │
              └── WireGuard 터널 (Tailscale) ──────────┘

   같은 카페 WiFi 의 비-tailnet 기기 → 100.x 에 라우팅 불가 → 접속 실패
```

## 2. 실측 확인 (2026-08-11, 이 기기)

```
tailscale ip -4        100.73.187.123
인터페이스              utun8   inet 100.73.187.123 --> 100.73.187.123 netmask 0xffffffff
MagicDNS               kimhyunbin-macbookpro.tail2a2edb.ts.net
BackendState           Running
CLI 경로                /usr/local/bin/tailscale
```

Tailscale 이 동작 중이고 MagicDNS 도 켜져 있습니다. 설계 전제가 성립합니다.

## 3. 보안 설계 — 여기가 이 기능의 핵심

읽기 전용이어도 **작업 일지 전문이 나갑니다.** 코드 조각·경로·의사결정이 담긴 문서라 유출 시 피해가 실질적입니다. 방어를 3겹으로 겹칩니다.

### 겹 1 — 바인딩 (R5) · 가장 중요

`0.0.0.0` 에 바인딩하면 안 됩니다. 카페 WiFi·공유기 LAN 의 아무 기기나 접속 가능해집니다. **Tailscale 인터페이스 주소에만** 바인딩하면 tailnet 을 거치지 않은 패킷은 애초에 이 소켓에 도달할 수 없습니다 — 애플리케이션 레벨 필터가 아니라 커널 레벨 사실입니다.

#### 함정 — "100.64/10 이면 Tailscale" 은 **틀렸다**

`100.64.0.0/10` 은 Tailscale 전용 대역이 아니라 **RFC 6598 CGNAT(캐리어급 NAT) 대역**입니다. ISP 가 CGNAT 을 쓰면 **사용자의 일반 WiFi 인터페이스에도 `100.64.x` 주소가 붙습니다.** 대역만 보고 고르면 그 환경에서 WiFi 인터페이스를 골라 바인딩합니다 — 정확히 막으려던 상황입니다.

실측으로 확실한 판별자를 확인했습니다 (2026-08-11, 이 기기):

```
Tailscale  utun8: flags=<UP,POINTOPOINT,RUNNING,MULTICAST>
                  inet 100.73.187.123 --> 100.73.187.123 netmask 0xffffffff
                                                         ^^^^^^^^^^^^^^^^^^  /32, broadcast 없음

WiFi       en0:   flags=<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST>
                  inet 192.168.75.41 netmask 0xffffff00 broadcast 192.168.75.255
                                             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^  /24, broadcast 있음
```

Tailscale 은 **`/32` 점대점 터널**(broadcast 없음, dst == src)이고, ISP CGNAT 이 물린 WiFi 는 **브로드캐스트 LAN**(`/24` 등 + broadcast 주소)입니다. 넷마스크와 broadcast 유무로 갈립니다.

#### 판정 규칙 — 세 조건 전부 만족해야 채택

```
(a) IPv4 주소가 100.64.0.0/10 안         → o[0] == 100 && (64..=127).contains(&o[1])
(b) 넷마스크가 /32 이고 broadcast 가 없다  → 브로드캐스트 LAN(= ISP CGNAT WiFi) 배제
(c) `tailscale ip -4` 를 실행할 수 있으면 그 결과 집합에 포함되어야 한다
      · CLI 없음        → (a)+(b) 로만 판정 (App Store 판 등)
      · CLI 있고 일치    → 채택
      · CLI 있고 불일치  → 채택하지 않고 서버 미기동   ← 애매하면 안 연다
```

(c) 를 필수가 아닌 **교차검증**으로 두는 이유: Mac App Store 판 Tailscale 은 `/usr/local/bin/tailscale` 을 설치하지 않고, LocalAPI 소켓도 표준 경로에 없습니다 (이 기기에서 확인). CLI 를 필수로 걸면 정상 사용자가 기능을 못 씁니다. 대신 CLI 가 **있는데 답이 다르면** 뭔가 잘못된 것이므로 열지 않습니다.

`--tun=userspace-networking` 모드에는 로컬 인터페이스가 아예 없습니다. 그 경우 탐지 실패 → 서버 미기동이 올바른 동작입니다.

`if-addrs` 가 넷마스크/broadcast 를 노출하지 않으면 `libc::getifaddrs` 를 직접 호출합니다. (b) 는 이 설계의 핵심이라 크레이트 편의를 위해 포기하지 않습니다.

#### 폴백 금지를 **타입으로** 강제한다

문서에 "폴백하지 말 것"이라고 써 두는 것만으로는 부족합니다. 나중에 "dev 에서 테스트가 안 되니 잠깐 127.0.0.1 로" 같은 변경이 들어오고 그대로 릴리스에 남는 게 이 부류 사고의 전형입니다.

**검증된 주소로만 만들 수 있는 newtype 을 두고, 서버 기동 함수가 그것만 받게 합니다:**

```rust
/// 검증을 통과한 Tailscale 인터페이스 주소. 필드가 private 이고
/// 생성자가 `detect()` 하나뿐이라 외부에서 임의 주소를 넣을 수 없다.
pub struct TailscaleBindAddr(Ipv4Addr);

impl TailscaleBindAddr {
    /// 위 (a)(b)(c) 를 전부 통과한 주소만 Some.
    pub fn detect() -> Option<Self> { … }
    pub fn ip(&self) -> Ipv4Addr { self.0 }
}

/// SocketAddr 이 아니라 TailscaleBindAddr 을 받는다 —
/// 0.0.0.0 / 127.0.0.1 을 넘기는 것은 **컴파일 에러**지 규율 문제가 아니다.
pub async fn serve(addr: TailscaleBindAddr, port: u16, …) -> Result<…>
```

이러면 폴백을 넣으려면 타입 정의를 고쳐야 하고, 그건 리뷰에서 반드시 눈에 띕니다.

#### 바인딩 후 되읽기 검증

`TcpListener` 를 만든 직후 `local_addr()` 를 되읽어 여전히 그 CGNAT 주소인지 확인하고, 아니면 리스너를 버리고 기동을 중단합니다. 설정 오류·플랫폼 차이로 커널이 다른 주소에 붙는 경우를 잡는 마지막 관문입니다.

#### 연결 단위 출발지 검사 (심층 방어)

바인딩이 어떤 이유로든 뚫렸을 때를 대비해, axum 미들웨어에서 `ConnectInfo<SocketAddr>` 의 **출발지 IP 가 `100.64.0.0/10` 밖이면 즉시 거부**합니다. 비용이 비교당 수 나노초라 안 넣을 이유가 없습니다.

이 검사는 (b) 를 적용하지 않습니다 — 출발지는 상대 tailnet 노드의 주소라 넷마스크 개념이 없습니다. 바인딩(겹 1)이 1차 방어, 이건 그게 실패했을 때의 그물입니다.

#### 요약 — 실패 시 동작

| 상황 | 동작 |
|---|---|
| Tailscale 미설치 / 중지 | 서버 미기동. 설정에 "Tailscale 이 실행 중이 아닙니다" |
| CGNAT 인터페이스 없음 (userspace 모드 등) | 서버 미기동 |
| CGNAT 주소는 있으나 브로드캐스트 LAN (ISP CGNAT) | **채택하지 않음.** 서버 미기동 |
| CLI 결과와 불일치 | 서버 미기동 |
| 바인딩 후 되읽기 불일치 | 리스너 폐기, 미기동 |

**어떤 경로로도 `0.0.0.0` · `127.0.0.1` · 일반 LAN 주소로 내려가지 않습니다.** 기동 실패는 조용히 넘어가지 않고 설정 화면에 사유가 표시됩니다.

### 겹 2 — 페어링 토큰

tailnet 안에 다른 사람의 기기가 있을 수 있고(공유 tailnet), 내 tailnet 기기가 탈취될 수도 있습니다. 기기 단위 인증을 겹칩니다.

```
1. 설정 → 모바일 에서 "기기 연결" 클릭
2. 앱이 6자리 페어링 코드 생성 (TTL 5분, 1회용) + 접속 URL 을 QR 로 표시
3. 폰이 QR 스캔 → 페어링 페이지 → 코드 입력
4. 서버가 32바이트 랜덤 토큰 발급 → 폰 localStorage 저장
5. 이후 모든 요청은 Authorization: Bearer <token>
6. 설정 화면에 연결된 기기 목록 + 개별 해제 버튼
```

토큰은 SQLite 에 **해시로만** 저장합니다 (평문 보관 시 DB 유출이 곧 접속 권한). 새 마이그레이션 `027_mobile_devices.sql`:

```sql
CREATE TABLE mobile_devices (
  id           INTEGER PRIMARY KEY,
  label        TEXT NOT NULL,        -- 사용자가 붙인 이름 ("아이폰")
  token_hash   TEXT NOT NULL UNIQUE, -- blake3(token) — 평문 미보관
  created_at   TEXT NOT NULL,
  last_seen_at TEXT
);
```

`blake3` 는 이미 의존성에 있습니다 (인덱서가 씀).

### 겹 3 — redaction 경로 강제 (R6)

`.oculpm/` 일지는 디스크에는 원문이지만, 읽을 때 시크릿이 마스킹됩니다 — `manager.get_journal_entry` (`manager.rs:947`) 가 캐시 미스 시 `JournalCache::with_redaction` 을 태웁니다.

**모바일 서버는 반드시 `OculpmManager` / `JournalCache` 를 경유합니다. 디스크 직독 금지.** 성능 때문에 파일을 바로 읽고 싶어지는 유혹이 있는데, 그 순간 redaction 이 우회되어 API 키가 폰으로 나갑니다.

이건 코드 리뷰 체크리스트 항목으로 명시합니다: *"mobile 모듈에 `fs::read` / `File::open` 이 있으면 반려."* (정적 자산 서빙 경로는 예외 — §5)

### 겹 3 보강 — HTTP 로 충분한 이유

Tailscale 자체가 WireGuard 로 종단 간 암호화합니다. 평문 HTTP 라도 tailnet 위에서는 이미 암호화된 터널 안입니다. `tailscale cert` 로 진짜 인증서를 받는 경로도 있지만 (MagicDNS 이름에 Let's Encrypt 발급), 갱신 관리가 붙고 1차 범위에서 얻는 게 적습니다. **HTTP 로 갑니다.** 설정 화면에 "Tailscale 터널로 암호화됩니다"를 명시해 사용자가 평문으로 오해하지 않게 합니다.

## 4. 백엔드 설계

### 4.1 신규 모듈 `src-tauri/src/mobile/`

```
mobile/
  mod.rs        MobileServer 상태 (JoinHandle + 바인딩 주소 + shutdown 채널)
  net.rs        Tailscale 주소 탐지 + MagicDNS 이름 조회
  auth.rs       페어링 코드 · 토큰 발급/검증 미들웨어
  routes.rs     API 핸들러
  assets.rs     모바일 번들 정적 서빙
```

### 4.2 의존성 추가

| 크레이트 | 용도 | 비고 |
|---|---|---|
| `axum` | HTTP 서버 | `tokio` 는 이미 있음. `hyper` 는 `reqwest` 로 이미 트리에 있음 |
| `tower-http` | `ServeDir` · CORS 불필요(동일 오리진) | 정적 서빙 |
| `if-addrs` | 인터페이스 열거 | 순수 Rust, 의존성 거의 없음 |

`qrcode` 크레이트는 **넣지 않습니다** — QR 은 프런트에서 그리는 게 더 쌉니다 (설정 화면이 이미 React).
프런트에도 QR 라이브러리 대신 30줄짜리 SVG QR 생성기를 쓸지, `qrcode.react` 같은 작은 의존성을 넣을지는 구현 시 결정합니다.

### 4.3 API (전부 읽기 전용)

`Bearer` 토큰 필수. 응답은 앱의 기존 타입을 그대로 직렬화합니다.

| 메서드 | 경로 | 재사용하는 기존 API |
|---|---|---|
| POST | `/api/pair` | (신규) 페어링 코드 → 토큰 |
| GET | `/api/projects` | `db.list_projects` |
| GET | `/api/home` | `home::collect` |
| GET | `/api/p/:id/journal?workday=&filter=` | `manager.list_journal_entries` |
| GET | `/api/p/:id/journal/*path` | `manager.get_journal_entry` |
| GET | `/api/p/:id/plans` | `commands::plan::plan_list` 내부 로직 |
| GET | `/api/p/:id/plans/:planId` | `plan_get` 내부 로직 |
| GET | `/api/p/:id/brief?workdays=` | `oculpm_workday_brief` 내부 로직 |

**전부 이미 있는 로직입니다.** 커맨드 핸들러(`State<'_, Db>` 를 받는 얇은 껍데기)에서 순수 로직을 분리해 axum 핸들러와 공유합니다. `commands/` 는 이미 "얇은 오케스트레이션" 규약이라 (CLAUDE.md) 분리 비용이 낮습니다.

명시적으로 **넣지 않는** 것: diff·코드 검색·그래프·터미널·AI. 읽기 전용이어도 이것들은 로컬 파일 시스템·LLM 키에 닿아 표면이 확 커집니다.

### 4.4 생명주기

```rust
pub struct MobileServer {
    inner: Mutex<Option<RunningServer>>,   // JoinHandle + bind addr + shutdown tx
}
```

`lib.rs` 의 `setup()` 에서 `app.manage(MobileServer::default())`. 부팅 시 설정(`mobile_enabled`)이 켜져 있으면 자동 기동합니다.

- 기동/정지 커맨드: `mobile_status` / `mobile_start` / `mobile_stop` / `mobile_pair_begin` / `mobile_devices_list` / `mobile_device_revoke`
- `ExitRequested` 에서 graceful shutdown — `shutdown_all_blocking` (`lib.rs:519`) 옆에 붙입니다
- **옵인 기본값 OFF.** 사용자가 명시적으로 켜야 뜹니다

포트는 기본 `7777`, 설정에서 변경 가능. 사용 중이면 다음 빈 포트를 찾지 말고 **에러를 표시**합니다 (포트가 조용히 바뀌면 폰 북마크가 깨짐).

## 5. 모바일 프런트 설계

### 5.1 별도 번들 — 앱 셸을 재사용하지 않는다

`ShellV2` 는 248px 사이드바·12화면·xterm·React Flow 를 전제한 데스크톱 UI 입니다. 폰에서 쓸 수 없고, 무엇보다 **Tauri IPC(`bindings.ts`)에 묶여 있어** 브라우저에서 동작하지 않습니다.

별도 Vite 엔트리를 만듭니다:

```
mobile.html                    ← 신규 rollup input
src/mobile/
  main.tsx                     엔트리 (Tauri 의존 0)
  api.ts                       fetch 래퍼 (Bearer 주입 · 401 → 페어링 화면)
  PairScreen.tsx               코드 입력
  ProjectList.tsx              프로젝트 선택
  JournalList.tsx / Entry.tsx  일지
  PlanList.tsx / Plan.tsx      플래너
  Today.tsx                    오늘 브리핑
```

`vite.config.ts` 의 `build.rollupOptions.input` 에 `index.html` 과 `mobile.html` 을 함께 넣습니다.

**스타일 재사용은 토큰만.** `src/styles/tokens.css` 의 색 토큰을 가져오면 앱과 같은 색감을 유지하면서 레이아웃은 모바일 전용으로 새로 짭니다. `App.css`·`screens.css` 는 데스크톱 레이아웃이라 가져오지 않습니다.

마크다운 렌더는 `react-markdown` + `remark-gfm` 을 재사용합니다 (이미 의존성).

### 5.2 정적 자산 서빙

`frontendDist: "../dist"` 라 빌드 산출물이 앱 번들의 리소스로 들어갑니다. axum 은 런타임에 `app.path().resource_dir()` 로 그 경로를 얻어 `ServeDir` 로 서빙합니다.

`include_dir!` 로 컴파일 타임에 박는 방법도 있지만, dev 루프(`pnpm tauri dev`)에서는 `dist/` 가 없고 Vite dev 서버만 도는 상태라 깨집니다. **런타임 리소스 읽기**로 갑니다. dev 에서는 Vite dev 서버(`localhost:1420/mobile.html`)로 프록시하거나, dev 한정으로 프로젝트 루트의 `dist/` 를 보게 합니다 — 구현 시 결정.

이 경로가 §3 "디스크 직독 금지" 규칙의 유일한 예외입니다. `ServeDir` 를 리소스 디렉토리에 **고정**하고 경로 탈출(`..`)을 막습니다. `tower-http` 의 `ServeDir` 가 기본으로 막지만, `commands/docs.rs` 에 이미 `secure_docs_join` 이라는 같은 문제의 선례가 있으니 그 패턴을 참고합니다.

### 5.3 오프라인 / 연결 실패

폰이 tailnet 밖(LTE·다른 WiFi)이면 요청이 그냥 실패합니다. 이건 **버그가 아니라 설계**이므로 UI 가 그렇게 말해야 합니다: "Tailscale 에 연결되어 있는지 확인하세요" + 재시도 버튼. 흰 화면이나 무한 스피너로 두면 사용자가 앱 버그로 오해합니다.

읽기 전용이라 오프라인 캐시(Service Worker)는 1차 범위 밖입니다.

## 6. 설정 UI

`SettingsPanel.tsx:43` 의 `TABS` 배열에 항목을 추가합니다. 순서는 `oculpm` 다음, `diagnostics` 앞:

```
모양 · LLM · 인덱싱&RAG · 그래프 · 데이터 · ocul-pm · [모바일] · 진단 · 업데이트
```

탭 내용:

```
┌ 모바일 연동 ─────────────────────────────────┐
│  [ ] 모바일 서버 켜기                          │
│                                              │
│  상태   ● 실행 중                             │
│  주소   http://kimhyunbin-macbookpro          │
│           .tail2a2edb.ts.net:7777    [복사]   │
│  포트   [7777]                                │
│                                              │
│  ┌────────────┐   폰에서 이 QR 을 스캔하세요    │
│  │ ██▄▄█ ▄██ │                               │
│  │ █ ▄▄▄ █▄█ │   페어링 코드  482 913        │
│  │ █▄▄▄▄▄█▀▄ │   4분 52초 남음               │
│  └────────────┘                              │
│                                              │
│  연결된 기기                                  │
│   · 아이폰      마지막 접속 3분 전   [해제]    │
│                                              │
│  ⓘ Tailscale 터널로 암호화되며, 같은 tailnet   │
│    기기에서만 접속할 수 있습니다.              │
└──────────────────────────────────────────────┘
```

Tailscale 이 없거나 꺼져 있으면 토글이 비활성이고 안내가 뜹니다: "Tailscale 이 실행 중이 아닙니다."

## 7. 테스트

바인딩 판정(§3 겹 1)은 이 기능에서 **유일하게 실패하면 안 되는 로직**이므로 테이블 주도로 촘촘히 덮습니다.

| 층 | 대상 |
|---|---|
| Rust 단위 | CGNAT 대역 판정 — `100.64.0.0`·`100.127.255.255` 참 / `100.63.255.255`·`100.128.0.0`·`10.x`·`192.168.x`·`172.16.x` 거짓 (경계값 포함) |
| Rust 단위 | **/32 + broadcast 없음 판정** — `(100.90.1.2, /32, bcast=None)` 채택 / **`(100.90.1.2, /24, bcast=Some)` 거부** ← ISP CGNAT WiFi 회귀 테스트 |
| Rust 단위 | 후보 0개 → `detect()` 가 `None`. 후보 여럿 → 결정적 선택 (첫 매치 고정, 실행마다 바뀌지 않음) |
| Rust 단위 | CLI 교차검증 — 결과 불일치 시 `None`. CLI 부재 시 (a)+(b) 로만 통과 |
| Rust 단위 | 페어링 코드 TTL 만료 · 1회용 소진 · 토큰 해시 검증 |
| Rust 통합 | 토큰 없음 / 잘못된 토큰 / 해제된 기기 토큰 → 전부 401 |
| Rust 통합 | 출발지 IP 가 CGNAT 밖이면 거부 (심층 방어 미들웨어) |
| Rust 통합 | 일지 응답이 redaction 을 통과했는지 — 시크릿 심은 픽스처로 검증 (R6) |
| 프런트 단위 | `src/mobile/api.ts` 의 401 → 페어링 화면 전환 |
| **수동** | 폰(tailnet)에서 접속 성공 |
| **수동** | 같은 LAN 의 비-tailnet 기기에서 **접속 실패** ← R5 게이트 |

두 번째 행이 이번 조사에서 발견한 구멍의 회귀 테스트입니다. `100.90.1.2/24 + broadcast` 는 **ISP CGNAT 이 물린 일반 WiFi** 의 모습이고, 이걸 채택하면 카페/공유기 LAN 에 열립니다. 대역만 보는 구현으로 되돌아가면 이 테스트가 즉시 빨개집니다.

`TailscaleBindAddr` 의 필드가 private 이고 생성자가 `detect()` 뿐이므로 "임의 주소로 서버를 띄우는" 경로는 **테스트로 막을 필요 없이 컴파일이 거부**합니다. 대신 그 불변식이 리팩토링에 살아남도록 타입 정의 위에 근거 주석을 답니다.

마지막 수동 항목이 이 기능의 최종 게이트입니다. 맥북의 LAN IP(현재 `192.168.75.41`)로 `:7777` 을 때려서 연결이 거부되는 것을 반드시 눈으로 확인합니다 — 코드 리뷰나 단위 테스트로 대체하지 않습니다.

## 8. 후속 (범위 밖, 기록만)

- 쓰기: 플래너 항목 status 토글 · 짧은 일지 작성. `OculpmManager` 락을 그대로 타므로 기술적으로는 가능하나, 모바일에서의 충돌·재시도 UX 설계가 별도로 필요
- 푸시 알림: `tauri-plugin-notification` 은 데스크톱용. 모바일 웹 푸시는 HTTPS + Service Worker 필요 → `tailscale cert` 도입과 묶임
- 다중 사용자 / tailnet 공유
