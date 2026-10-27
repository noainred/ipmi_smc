# 맥북(Apple Silicon)에서 실제 장비로 PoC 실행하기

> 이 문서의 절차는 macOS 표준 동작과 Homebrew 기준이다. 이 PoC 를 만든 환경은 Linux 라 맥에서 직접 눌러 보지는 못했다 —
> 막히는 단계가 있으면 터미널 출력이나 화면 문구를 그대로 알려 주면 된다.

## 1. 준비물

| 항목 | 필수 | 설치·확인 |
|---|---|---|
| Node.js 20.6+ (권장 22 LTS, arm64) | 예 | https://nodejs.org 의 macOS 설치 파일, 또는 `brew install node@22` 후 안내대로 PATH 추가. 확인: `node -v` |
| ipmitool | 아니오(IPMI 비교에만) | `brew install ipmitool` · 확인: `ipmitool -V` |
| BMC 관리망 접근 | 예 | 맥이 BMC IP 에 닿아야 한다(사내망·VPN). HTTPS **443/TCP**, IPMI **623/UDP** |
| BMC 계정 | 예 | 가능하면 **읽기 전용 계정**을 따로 만든다(아래 4절) |

외부 npm 패키지는 없다(`npm install` 불필요).

## 2. 받기

```bash
git clone https://github.com/noainred/ipmi_smc.git
cd ipmi_smc
```

ZIP 으로 받았다면 macOS 가 '인터넷에서 받은 파일' 표시를 붙여 `start.command` 실행을 막을 수 있다:

```bash
xattr -dr com.apple.quarantine ~/Downloads/ipmi_smc-*      # 압축을 푼 폴더
chmod +x ~/Downloads/ipmi_smc-*/start.command
```

## 3. 실행

```bash
node app.js
```

- 브라우저가 `http://127.0.0.1:8710/` 으로 열린다(8710 이 쓰이고 있으면 8711… 로 자동으로 옮긴다 — 터미널에 주소가 나온다).
- Finder 에서 `start.command` 더블클릭도 같다(처음 한 번은 우클릭 → 열기).
- 끝낼 때는 터미널에서 `Ctrl+C`. 실행 중인 수집은 진행 중인 요청이 끝나면 멈춘다.
- 화면은 이 맥 안에서만 열린다(127.0.0.1). 같은 네트워크의 다른 PC 는 접속할 수 없다.

## 4. BMC 계정 준비(권장)

- Supermicro BMC 웹 화면 → 사용자 관리에서 PoC 전용 계정을 만든다. 처음엔 **Operator** 권한으로 돌려 보고,
  '권한 403' 이 많이 나오면 그 항목만 Administrator 로 다시 확인한다(어떤 자원이 어떤 권한을 요구하는지도 PoC 결과다).
- **계정 잠금 정책**은 결과의 '수집 정보 → 계정 · 잠금 정책'(Redfish `AccountLockoutThreshold`)에 나온다.
  PoC 는 인증이 한 번 거부되면 그 서버에 더 보내지 않는다(실행 1회당 실패 로그인 최대 2회: Basic 1 + 세션 1, Digest 를 광고하면 +1).
- 같은 계정으로 IPMI 를 쓰려면 BMC 의 **IPMI over LAN** 이 켜져 있어야 한다(결과의 'BMC 서비스(IPMI·SSH·SNMP)' 행에서 확인).

## 5. 서버 등록 · 실행

1. **서버 · 실행** 탭 → 오른쪽 '서버 등록'
   - 역할: Supermicro 는 **Supermicro 대상**, 비교용 Dell 은 **Dell 기준선(비교용)**
   - BMC 주소: IP 또는 호스트명(포트가 443 이 아니면 포트 칸에)
   - '연결 확인(무인증)' 은 계정 없이 서비스 루트만 읽어 벤더·Redfish 버전을 보여 준다 — 저장 전에 경로·방화벽 확인용
   - BMC 인증서가 자체서명이면(대부분) '인증서 확인 안 함' 을 켠 채로 둔다
2. 저장 → 목록에서 체크 → **선택한 서버 실행**
   - 한 대에 보통 1~5분(전체 탐색 자원 수·BMC 응답 속도에 따라). 진행 막대와 요청 로그로 상황을 본다.
3. 결과
   - **비교 매트릭스**: Dell 열과 Supermicro 열을 같은 행에서 비교, 셀을 누르면 근거
   - **The.DVC 수정 지점**: Supermicro 를 The.DVC 에 넣을 때 고칠 곳
   - **IPMI 대조 · 수집 정보 · 전체 탐색**: 세부 값·원문
4. 공유: 비교 매트릭스 탭의 **HTML 내보내기**(한 파일)·**Markdown**. 원문까지 보내려면 `out/` 폴더를 압축한다.
   **`data/` 폴더는 보내지 않는다**(비밀번호).

## 6. 문제 해결

| 증상 | 원인·조치 |
|---|---|
| `인증서 검증 실패(...)` | 자체서명 BMC — 서버 수정에서 '인증서 확인 안 함' 을 켠다 |
| `최신 TLS 협상 실패 → 구형 TLS 호환 모드로 접속` | 오래된 BMC 펌웨어 — PoC 가 자동으로 다시 시도한 것(정보 표시). 이 사실 자체가 The.DVC 이식 시 고려 사항 |
| `연결 거부(포트가 닫혀 있음)` · `시한 초과` | 443 차단·BMC HTTPS 꺼짐·VPN 미연결. `nc -vz <BMC> 443` 으로 확인 |
| `인증 실패` | 사용자·비밀번호·계정 잠금·권한 확인. PoC 는 그 서버에 더 시도하지 않는다 — 고친 뒤 다시 실행 |
| `라이선스 추정` | 거부 문구에 라이선스(SFT-DCMS 등)가 나온 자원. 셀을 눌러 원문 메시지를 확인 |
| IPMI `세션을 열지 못함` | 623/UDP 차단·IPMI over LAN 꺼짐·인증 거부 중 하나. 터미널에서 `export IPMI_PASSWORD=…; ipmitool -I lanplus -H <BMC> -U <user> -E mc info` 로 직접 확인 |
| IPMI `ipmitool 이 설치되어 있지 않음` | `brew install ipmitool` 후 다시 실행(다른 위치에 있으면 `SMC_POC_IPMITOOL=/경로/ipmitool node app.js`) |
| 화면이 안 열림 | 터미널에 나온 주소를 브라우저에 직접 입력. 포트 지정: `PORT=9000 node app.js` |

## 7. 결과를 The.DVC 쪽으로 넘길 때

`out/<서버 id>/<실행>/raw/` 의 원본 응답이 The.DVC 테스트 픽스처 재료다. 서버별 `result.json` 과 함께 넘기면
'Supermicro 를 The.DVC 벤더로 추가' 작업을 실제 응답 기준으로 할 수 있다([COMPAT-REVIEW.md](COMPAT-REVIEW.md) 4절).
