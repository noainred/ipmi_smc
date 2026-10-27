/**
 * The.DVC 의 Dell 가정 지점 13개를 실제 응답에 적용한다 — "이 서버를 The.DVC 에 그대로 넣으면 어디가 틀리는가".
 *
 * verdict: break(깨짐 — 값이 비거나 틀림) · check(확인 — 사람이 응답을 보고 판단) · ok(정상) · info(정보) · unknown(판정 근거 없음)
 * 파일:줄은 The.DVC 기준 커밋 d75a13c 기준이다.
 */
import { BIOS_KEYS, classifyFw } from './rules.js';
import { dvcScanOutcome } from '../redfish/vendor.js';
import { isPlaceholder } from '../util/placeholder.js';

export const ASSUMPTIONS = [
  { no: 1, id: 'vendorScan', title: '스캔이 이 벤더를 등록하는가', where: 'idrac/scan.js:59-69,191 · registry.js:503 normVendor', assume: '벤더는 dell / hpe 둘뿐 — 나머지는 unsupported', fix: '벤더 열거에 supermicro 추가 · 계정 세트 분리(HPE iLO 선례 v2.610)', checks: ['serviceRoot'] },
  { no: 2, id: 'serviceTag', title: '서비스태그(장비 키)가 서버마다 고유한가', where: 'idrac/redfish.js:374 systemServiceTag', assume: 'HPE 가 아니면 SKU 를 먼저 쓴다(Dell SKU = 서비스태그)', fix: 'Supermicro 는 SerialNumber 우선 + 자리표시 문자열 거부', checks: ['system'] },
  { no: 3, id: 'firmwareFilter', title: '펌웨어 목록 필터', where: 'idrac/redfish.js:982', assume: 'FirmwareInventory 멤버 id 가 Installed- 로 시작', fix: '벤더별 필터 — Installed- 가 없으면 전체 멤버', checks: ['firmware'] },
  { no: 4, id: 'logPaths', title: '하드웨어 이벤트 로그 경로', where: 'idrac/redfish.js:793', assume: 'Manager LogServices 이름이 Sel 또는 Lclog', fix: 'LogServices 를 열거해 Entries 가 있는 서비스를 쓴다', checks: ['logs'] },
  { no: 5, id: 'telemetry', title: 'CPU·메모리 사용률(텔레메트리)', where: 'redfish.js:1186,1457 · bmusage/parse/idracTelemetry.js', assume: 'TelemetryService 의 SystemUsage 리포트(Dell Datacenter)', fix: 'Supermicro 는 OS 경로(SSH) 또는 실제 센서·리포트 이름 매핑', checks: ['telemetry', 'usageSensors'] },
  { no: 6, id: 'license', title: 'BMC 라이선스 판독', where: 'redfish.js:930 · bmusage/license.js', assume: 'LicenseService/Licenses 또는 Oem/Dell/DellLicenses + Dell 등급 이름', fix: 'Supermicro 라이선스 경로·등급(SFT-DCMS 등) 별도 판정', checks: ['licenses'] },
  { no: 7, id: 'racadm', title: 'Enterprise 대체 경로(racadm SSH)', where: 'bmusage/targets.js:142,193', assume: '대체 경로 제외는 vendor === hpe 만', fix: 'entAllowed 를 vendor === dell 일 때만 true 로', checks: ['racadm'] },
  { no: 8, id: 'bios', title: 'BIOS 주요 설정 · 펌웨어 분류', where: 'redfish.js:436 BIOS_KEYS · 1004 classifyFw', assume: 'Dell BIOS 속성명 · iDRAC 펌웨어 이름', fix: 'Supermicro 속성명 표·BMC 분류 추가', checks: ['bios', 'firmware'] },
  { no: 9, id: 'roomTemp', title: '전산실 흡기 온도 분류', where: 'idrac/roomTemp.js:91 classifySensor', assume: 'Dell 센서명(System Board Inlet Temp 등)', fix: '실제 센서 이름으로 정규식 보강', checks: ['thermal'] },
  { no: 10, id: 'powerSum', title: '전력 합산(섀시 여러 개)', where: 'idrac/redfish.js:399 fetchPower', assume: '전 섀시의 PowerControl 을 더한다(섀시 1개 가정)', fix: '노드 섀시만 합산하거나 PhysicalContext 확인', checks: ['power'] },
  { no: 11, id: 'ipmiVersion', title: 'IPMI 버전 표기', where: 'idrac/redfish.js:633', assume: "ipmiVersion: '2.0' 하드코드", fix: '실측값 사용(값이 같으면 수정 불필요)', checks: [] },
  { no: 12, id: 'keyFormats', title: '부품 키 형식(DIMM·NIC 포트)', where: 'partfault/extract/idrac.js:148 · idrac/nicPorts.js', assume: 'Dell FQDD(DIMM.Socket.A1 · NIC.Integrated.1-1)', fix: '키 형식만 다름 — 판정 영향 없음(표시만 확인)', checks: ['memory', 'nics'] },
  { no: 13, id: 'schema', title: '구 Power/Thermal 스키마 의존', where: 'redfish.js:391,1116', assume: 'Chassis Power · Thermal 만 읽음', fix: '구 스키마가 없으면 PowerSubsystem·ThermalSubsystem 폴백', checks: ['power', 'thermal', 'powerSubsystem', 'thermalSubsystem'] },
];

const v = (verdict, seen) => ({ verdict, seen });

/**
 * @param {object} r  한 서버 결과 { checks, ipmi, vendor }
 * @returns {object[]} ASSUMPTIONS 와 같은 순서, 각 항목 + { verdict, seen }
 */
export function evaluateAssumptions(r) {
  const c = r.checks || {};
  const d = (id) => c[id]?.data || {};
  const st = (id) => c[id]?.status || 'skip';
  const vendor = r.vendor || d('serviceRoot').vendor || 'unknown';
  const out = {};

  // 1
  {
    const o = dvcScanOutcome(vendor);
    out.vendorScan = st('serviceRoot') === 'error' ? v('unknown', '서비스 루트 응답 없음')
      : v(o.registered ? 'ok' : 'break', `${d('serviceRoot').vendorLabel || vendor} (${d('serviceRoot').vendorEvidence || '근거 없음'}) → ${o.label}`);
  }
  // 2
  {
    const sys = d('system');
    if (!['ok', 'partial'].includes(st('system'))) out.serviceTag = v('unknown', `Systems ${st('system')}`);
    else {
      const tag = sys.dvcServiceTag || '';
      const from = sys.dvcServiceTagFrom;
      if (isPlaceholder(tag)) out.serviceTag = v('break', `${from} = "${tag || '(빈 값)'}" → 자리표시라 서버마다 같은 장비 키가 된다`);
      else if (vendor !== 'dell' && from === 'SKU' && sys.SerialNumber && sys.SKU !== sys.SerialNumber) out.serviceTag = v('check', `SKU = "${sys.SKU}" 를 태그로 씀(SerialNumber "${sys.SerialNumber}" 아님) — 같은 모델끼리 겹치는지 여러 대로 확인`);
      else out.serviceTag = v('ok', `${from} = "${tag}"`);
    }
  }
  // 3
  {
    const f = d('firmware');
    if (st('firmware') !== 'ok') out.firmwareFilter = v('unknown', `FirmwareInventory ${st('firmware')}`);
    else if (f.members > 0 && f.dvcInstalledMatches === 0) out.firmwareFilter = v('break', `멤버 ${f.members}개 중 Installed- 0개 → The.DVC 펌웨어 목록이 빈다 (예: ${(f.firmware || []).slice(0, 3).map((x) => x.Id).join(', ')})`);
    else out.firmwareFilter = v('ok', `Installed- ${f.dvcInstalledMatches}/${f.members}`);
  }
  // 4
  {
    const l = d('logs');
    const svcs = (l.services || []).map((x) => `${x.owner.split('/')[0]}/${x.id}(${x.entries ?? '?'})`);
    if (!['ok', 'empty'].includes(st('logs'))) out.logPaths = v('unknown', `LogServices ${st('logs')}`);
    else if ((l.dvcFixedPathsFound || []).length) out.logPaths = v('ok', `${l.dvcFixedPathsFound.join('·')} 있음 · 전체: ${svcs.join(' · ')}`);
    else out.logPaths = v('break', `Sel·Lclog 없음 → The.DVC 이벤트 0건 · 실제: ${svcs.join(' · ') || '—'}`);
  }
  // 5
  {
    const t = d('telemetry');
    const u = d('usageSensors');
    if (st('telemetry') === 'ok' && t.usage?.cpuPct) out.telemetry = v('ok', `CPU ${t.usage.cpuPct.value} (${t.usage.cpuPct.report}/${t.usage.cpuPct.metricId})`);
    else if (st('usageSensors') === 'ok') out.telemetry = v('check', `텔레메트리 ${st('telemetry')} · Sensors 이름 패턴으로 ${Object.keys(u.found || {}).join(', ')} 찾음(The.DVC Enterprise 경로가 읽을 수 있음)`);
    else out.telemetry = v('break', `TelemetryService ${st('telemetry')}${t.reportIds?.length ? ` · 리포트 ${t.reportIds.slice(0, 5).join(', ')}` : ''} · 사용률 센서 ${st('usageSensors')} → CPU·메모리 사용률 빈칸`);
  }
  // 6
  {
    const l = d('licenses');
    const std = (l.licenses || []).filter((x) => x.from === '표준 LicenseService' || x.from.startsWith('Dell'));
    const other = [...(l.licenses || []).filter((x) => !std.includes(x)), ...(l.resources || [])];
    if (std.length) out.license = v('ok', `${std.length}건: ${std.map((x) => x.Name).slice(0, 3).join(', ')}`);
    else if (other.length) out.license = v('break', `The.DVC 경로 0건 · 다른 경로에 라이선스 관련 자원 ${other.length}개(${[...new Set(other.map((x) => x.path || x.from))].slice(0, 3).join(', ')}) — The.DVC 는 읽지 못함`);
    else out.license = v(vendor === 'dell' ? 'check' : 'break', '라이선스 정보를 어느 경로에서도 읽지 못함');
  }
  // 7
  out.racadm = vendor === 'dell' || vendor === 'hpe'
    ? v('ok', vendor === 'dell' ? 'Dell — 의도된 대상' : 'HPE — 이미 제외됨')
    : v('break', `vendor='${vendor}' 는 제외 대상이 아님 → 동의가 켜진 현장에서 이 BMC 에 SSH racadm 을 시도(코드 분석 — PoC 는 실행 안 함)`);
  // 8
  {
    const b = d('bios');
    const f = d('firmware');
    const other = (f.firmware || []).filter((x) => x.dvcType === '기타').map((x) => x.Name || x.Id);
    const bmcFw = (f.firmware || []).find((x) => /bmc|ipmi/i.test(`${x.Name} ${x.Id}`));
    const parts = [];
    if (st('bios') === 'ok') parts.push(`BIOS 속성 ${b.count}개 중 The.DVC 주요 키 ${b.dvcCuratedHits?.length || 0}/${BIOS_KEYS.length}`);
    else parts.push(`BIOS ${st('bios')}`);
    if (bmcFw) parts.push(`BMC 펌웨어 '${bmcFw.Name || bmcFw.Id}' → ${classifyFw(bmcFw.Name || bmcFw.Id)}`);
    if (other.length) parts.push(`'기타' 분류 ${other.length}개`);
    const bad = st('bios') !== 'ok' || (b.dvcCuratedHits?.length || 0) === 0;
    out.bios = v(bad ? 'check' : 'ok', parts.join(' · '));
  }
  // 9
  {
    const th = d('thermal');
    if (!['ok', 'partial'].includes(st('thermal'))) out.roomTemp = v('unknown', `Thermal ${st('thermal')}`);
    else if ((th.dvcInlet || []).length) out.roomTemp = v('ok', `흡기: ${th.dvcInlet.join(', ')}`);
    else out.roomTemp = v('break', `흡기로 분류되는 센서 0개 → 전산실 온도 빈칸 · 센서: ${(th.temps || []).map((x) => x.name).slice(0, 8).join(', ')}`);
  }
  // 10
  {
    const p = d('power');
    if (!['ok', 'partial'].includes(st('power'))) out.powerSum = v('unknown', `Power ${st('power')}`);
    else if ((p.chassisWithWatts || 0) > 1) out.powerSum = v('check', `PowerConsumedWatts 가 있는 섀시 ${p.chassisWithWatts}개 → The.DVC 는 ${p.dvcTotalWatts} W 로 합산(${(p.perChassis || []).filter((x) => x.watts != null).map((x) => `${x.chassis} ${x.watts}W`).join(' + ')}) — 이중 합산인지 확인`);
    else out.powerSum = v('ok', `섀시 1개 · ${p.dvcTotalWatts} W`);
  }
  // 11
  {
    const mc = r.ipmi?.parsed?.mcInfo;
    if (mc?.ipmiVersion) out.ipmiVersion = v(String(mc.ipmiVersion).trim() === '2.0' ? 'ok' : 'check', `mc info: IPMI ${mc.ipmiVersion} · 제조사 ${mc.manufacturerName || mc.manufacturerId || '—'}`);
    else out.ipmiVersion = v('unknown', r.ipmi?.stoppedReason || 'IPMI 를 실행하지 않음');
  }
  // 12
  {
    const dimm = (d('memory').dimms || []).slice(0, 2).map((x) => x.locator);
    const port = (d('nics').adapters || []).flatMap((a) => a.ports || []).slice(0, 2).map((x) => x.id);
    out.keyFormats = v('info', `DIMM: ${dimm.join(', ') || '—'} · NIC 포트: ${port.join(', ') || '—'}`);
  }
  // 13
  {
    const oldOk = ['ok', 'partial'].includes(st('power')) && ['ok', 'partial'].includes(st('thermal'));
    const newOk = st('powerSubsystem') === 'ok' || st('thermalSubsystem') === 'ok';
    if (!oldOk && newOk) out.schema = v('break', `Power ${st('power')} · Thermal ${st('thermal')} 인데 신 스키마는 있음 → The.DVC 는 전력·온도를 못 읽음`);
    else if (oldOk && newOk) out.schema = v('info', '구·신 스키마 모두 제공(지금은 영향 없음)');
    else if (oldOk) out.schema = v('ok', '구 스키마 제공');
    else out.schema = v('unknown', `Power ${st('power')} · Thermal ${st('thermal')}`);
  }

  // 접속 자체가 안 됐으면(서비스 루트 무응답) 벤더도 모른다 — 전 항목 판정 불가.
  if (r.fatal || (r.probe && !r.probe.status)) {
    for (const k of Object.keys(out)) if (k !== 'ipmiVersion') out[k] = v('unknown', `Redfish 접속 실패 — 판정 불가${r.fatal ? ` (${String(r.fatal).slice(0, 120)})` : ''}`);
  }
  // 인증이 거부됐으면 응답을 받지 못한 항목은 판정할 수 없다 — '깨짐' 으로 쓰지 않는다(벤더 판별·코드 분석·IPMI 항목만 유지).
  if (r.auth?.failed) {
    for (const k of Object.keys(out)) if (!['vendorScan', 'racadm', 'ipmiVersion'].includes(k)) out[k] = v('unknown', 'Redfish 인증 실패로 응답을 받지 못함 — 판정 불가');
  }
  return ASSUMPTIONS.map((a) => ({ ...a, ...(out[a.id] || v('unknown', '')) }));
}

export function verdictCounts(list) {
  const c = { break: 0, check: 0, ok: 0, info: 0, unknown: 0 };
  for (const a of list || []) c[a.verdict] = (c[a.verdict] || 0) + 1;
  return c;
}
