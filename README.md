# ipmi_smc — Supermicro BMC 수집 호환성 PoC

The.DVC 의 서버(iDRAC) 수집은 **Dell iDRAC 기준**으로 만들어졌다. 이 PoC 는 Supermicro 서버 BMC 에 **실제로 접속해**
The.DVC 가 Dell 에서 읽는 정보를 같은 방식(Redfish)으로 읽을 수 있는지, IPMI(ipmitool)로는 무엇을 대신 받을 수 있는지,
그리고 **그 응답을 The.DVC 에 그대로 넣으면 어디가 틀리는지**를 Dell 서버와 나란히 비교한다.

- 로컬 웹 화면에서 서버를 등록하고 실행한다(맥북에서 `node app.js` 한 줄 — 외부 패키지 0개).
- 읽기 전용이다: Redfish 는 GET 과 세션 생성·삭제만, IPMI 는 읽기 명령만 보낸다.
- 받은 원본 응답을 전부 파일로 남긴다(비밀 필드 가림) — The.DVC 를 고칠 때 테스트 픽스처 재료가 된다.

## 맥북(Apple Silicon)에서 바로 실행

```bash
# 1) Node.js 22 LTS — https://nodejs.org (macOS 설치 파일) 또는 brew install node@22
node -v                      # v20.6 이상이면 된다(권장 22)

# 2) (선택) IPMI 비교용
brew install ipmitool

# 3) 받기 · 실행
git clone https://github.com/noainred/ipmi_smc.git && cd ipmi_smc
node app.js                  # 브라우저가 http://127.0.0.1:8710/ 으로 열린다
```

Finder 에서 `start.command` 를 더블클릭해도 된다(처음 한 번은 우클릭 → 열기). 자세한 절차·네트워크·문제 해결은 [docs/MAC-RUN.md](docs/MAC-RUN.md).

## 화면

| 탭 | 내용 |
|---|---|
| 서버 · 실행 | 서버 등록(역할: **Supermicro 대상 / Dell 기준선** / 기타)·수정·삭제, 무인증 연결 확인, 선택 실행, 단계별 진행·요청 로그 |
| 비교 매트릭스 | 점검 29개 × 서버 열 + **Dell 기대(The.DVC 코드 기준)** 열 + The.DVC 영향. 셀을 누르면 근거(요청 경로·HTTP 상태·받은 값) |
| The.DVC 수정 지점 | Dell 가정 13개를 받은 응답에 적용한 결과(깨짐·확인·정상·정보·미확인 + 본 것 + 이식 제안) |
| IPMI 대조 | DCMI 전력 ↔ Redfish 전력, FRU ↔ 시리얼, mc info, SEL ↔ Redfish 로그, SDR ↔ Redfish 센서 이름 대응, 명령별 원문 |
| 수집 정보 | 서버에서 읽은 값 전부(신원·펌웨어·온도·팬·센서 전체·전력·PSU·DIMM·CPU/GPU·디스크·NIC·PCIe·로그·계정·BIOS 속성 전체·라이선스·텔레메트리) |
| 전체 탐색 | `/redfish/v1` 에서 링크를 따라 읽은 모든 자원(기본 상한 2,000) 트리·검색·원문, Dell ↔ Supermicro 경로 패턴 비교 |

결과는 **HTML(한 파일, 서버 없이 열림)** 과 **Markdown** 으로 내보낼 수 있다(비교 매트릭스 탭).

## 무엇을 읽는가

- **Redfish 점검 29개** — The.DVC 함수와 1:1(`probeIdrac`·`fetchPower`·`fetchInventory`·`fetchSensors`·`fetchSensorCollection`·
  `fetchFirmwareInventory`·`fetchUsage`·`fetchUsageSensors`·`probeGpuTelemetry`·`idracEnterprise`) + PoC 추가
  (NetworkProtocol·계정 잠금 정책·PowerSubsystem·ThermalSubsystem·EventService·VirtualMedia·Oem). 목록: `src/redfish/checks.js` `CHECKS`.
- **전체 Redfish 탐색** — 상한(자원 2,000·5분·동시 2·컬렉션당 64)을 넘으면 멈추고 그 사실을 결과에 적는다.
  JSON 스키마·메시지 레지스트리 본문·세션·로그 항목 개별 문서·Actions 는 건너뛴다.
- **IPMI 읽기 명령 15개** — `mc info`·`mc guid`·`chassis status`·`chassis restart_cause`·`fru print`·`sdr info`·`sdr elist full`·
  `sel info`·`sel elist last 30`·`dcmi power reading`·`dcmi get_temp_reading`·`lan print 1`·`user list 1`·`channel info 1`·`sol info 1`.

## 안전 규칙(실장비에 돌리는 도구다)

- Redfish 메서드 화이트리스트: GET(`/redfish/` 아래) · 세션 생성 POST · **내가 만든 세션** DELETE. PATCH·PUT·Actions 는 코드 경로가 없다.
- 인증이 거부되면(Basic·Digest·세션 모두) 그 서버에는 더 보내지 않는다. 같은 계정이면 IPMI 도 시도하지 않는다(BMC 계정 잠금 방지).
- IPMI 비밀번호는 명령줄에 넣지 않는다(`ipmitool -E` + 환경변수). 상태를 바꾸는 ipmitool 명령은 코드가 거부한다.
- 화면 서버는 `127.0.0.1` 에만 열리고, 실행마다 바뀌는 토큰·Host 검사로 다른 웹페이지의 요청 위조를 막는다.
- 비밀번호는 `data/servers.json`(권한 600)에만 저장하고 화면·결과·원본 덤프에 싣지 않는다. 주소를 바꾸면 비밀번호를 다시 받는다.

## 결과 파일

```
out/<서버 id>/<실행 시각>/result.json   판정·요약·전체 탐색 색인·IPMI 결과
out/<서버 id>/<실행 시각>/raw/*.json    받은 원본 응답(경로별 1파일, 비밀 필드·URL 속 비밀번호 가림)
out/<서버 id>/latest.json               최신 실행 포인터(서버별 최근 5회만 유지)
```
`data/`(비밀번호)와 `out/` 는 `.gitignore` 에 있다. 결과를 공유할 때는 `out/` 만 보낸다 — 시리얼·MAC·IP 같은 장비 정보는 들어 있다.

## 장비 없이 해 보기(목 서버)

```bash
npm run mock        # Supermicro형 127.0.0.1:9001 (ADMIN/ADMIN) · Dell형 127.0.0.1:9002 (root/calvin)
node app.js         # 다른 터미널 — 서버 등록 시 주소를 http://127.0.0.1:9001 처럼 http:// 를 붙여 입력
```
⚠ 목 서버 응답(`mock/fixtures.js`)과 테스트용 가짜 ipmitool(`test/fixtures/fake-ipmitool.cjs`)은 **합성 데이터**다.
코드 경로 시험·화면 데모용이며 Supermicro 실제 동작의 근거가 아니다.

## CLI

```bash
SMC_PASS='비밀번호' node bin/smc-poc.js --host 10.10.2.31 --user ADMIN            # 한 대
node bin/smc-poc.js --targets targets.example.json                                # 여러 대(비밀번호는 passwordEnv 의 환경변수)
```

## 정직 기록 · 한계

- 이 저장소는 Linux 개발 환경에서 만들고 시험했다. **맥에서 직접 실행해 보지는 못했다** — 근거는 Node 표준 모듈만 쓰고(네이티브 모듈·빌드 없음)
  경로를 `path` 로만 조립한다는 점이다. 맥에서 문제가 나면 화면의 오류 문구나 터미널 출력을 그대로 알려 주면 된다.
- **실제 Supermicro 응답은 아직 본 적이 없다.** Supermicro 관련 예상(SKU 자리표시·`Log1` 로그 경로·라이선스 문구 등)은 공개 자료 기반 **추정**이며,
  이 PoC 를 현장에서 돌린 결과가 그것을 확정·반증한다.
- '라이선스 추정' 배지는 거부 응답 본문의 문구(license·DCMS·SFT-…)로 고른 것이다. 문구 없이 403 이면 '권한 403' 으로 표시한다.
- The.DVC 판정식은 기준 커밋 `d75a13c` 에서 옮겨 왔다(`src/dvc/rules.js`). The.DVC 가 바뀌면 다시 옮겨야 한다.

## 개발

```bash
npm test            # node:test — 파서·판정·안전 규칙·목 서버 종단·웹 API
```
상세 검토 문서: [docs/COMPAT-REVIEW.md](docs/COMPAT-REVIEW.md)
