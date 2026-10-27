/**
 * 점검 항목 — The.DVC 가 Dell iDRAC 에서 읽는 것을 같은 Redfish 경로로 읽고(+ PoC 추가 항목), 결과를 판정한다.
 * 각 항목은 { id, status, note, data, evidence } 를 돌려준다. status 는 status.js 의 키다.
 *
 * `dell` 은 **The.DVC 코드 기준 기대값**이다(Dell iDRAC9 에서 그 코드가 읽도록 만들어진 것) — 실측이 아니다.
 * Dell 서버를 함께 등록해 실행하면 화면이 실측 열을 따로 보여 준다.
 */
import { membersOf, linkOf } from './context.js';
import { bestOf } from './status.js';
import { classifyBmcVendor, dvcScanOutcome } from './vendor.js';
import {
  systemServiceTag, nicPortSpeedMbps, BIOS_KEYS, classifyFw, FW_INSTALLED_RE, DVC_LOG_SERVICES, DVC_LICENSE_PATHS,
  isGpuProcessor, USAGE_IDS, sensorFieldOf, classifyRoomSensor, REPORT_KINDS,
} from '../dvc/rules.js';
import { isPlaceholder } from '../util/placeholder.js';

export const CHECKS = [
  { id: 'serviceRoot', group: '신원 · 관리', feature: '서비스 루트 · 벤더 판별', fn: 'probeIdrac · classifyBmcVendor', path: '/redfish/v1 (무인증)', dell: ['ok', 'Vendor · Oem.Dell'] },
  { id: 'system', group: '신원 · 관리', feature: '시스템 신원(모델·시리얼·SKU)', fn: 'fetchInventory · fetchPower', path: '/Systems/{id}', dell: ['ok', 'SKU = 서비스태그'] },
  { id: 'manager', group: '신원 · 관리', feature: 'BMC 펌웨어 · 관리 NIC', fn: 'fetchInventory', path: '/Managers/{id} · /EthernetInterfaces', dell: ['ok', ''] },
  { id: 'networkProtocol', group: '신원 · 관리', feature: 'BMC 서비스(IPMI·SSH·SNMP)', fn: '— (PoC 추가)', path: '/Managers/{id}/NetworkProtocol', dell: ['ok', 'The.DVC 미사용'] },
  { id: 'accounts', group: '신원 · 관리', feature: 'BMC 계정 · 잠금 정책', fn: 'fetchInventory', path: '/AccountService(/Accounts)', dell: ['ok', ''] },
  { id: 'power', group: '전력', feature: '소비전력(W)', fn: 'fetchPower', path: '/Chassis/{id}/Power', dell: ['ok', 'PowerControl 합산'] },
  { id: 'psu', group: '전력', feature: 'PSU 상세', fn: 'fetchInventory', path: 'Power.PowerSupplies[]', dell: ['ok', ''] },
  { id: 'powerSubsystem', group: '전력', feature: 'PowerSubsystem(신 스키마)', fn: '— (The.DVC 미사용)', path: '/Chassis/{id}/PowerSubsystem', dell: ['partial', '펌웨어에 따라(추정)'] },
  { id: 'thermal', group: '온도 · 팬 · 센서', feature: '온도 센서', fn: 'fetchSensors · roomTemp', path: '/Chassis/{id}/Thermal', dell: ['ok', 'System Board Inlet Temp 등'] },
  { id: 'fans', group: '온도 · 팬 · 센서', feature: '팬', fn: 'fetchSensors', path: 'Thermal.Fans[]', dell: ['ok', 'RPM'] },
  { id: 'thermalSubsystem', group: '온도 · 팬 · 센서', feature: 'ThermalSubsystem(신 스키마)', fn: '— (The.DVC 미사용)', path: '/Chassis/{id}/ThermalSubsystem', dell: ['partial', '펌웨어에 따라(추정)'] },
  { id: 'sensors', group: '온도 · 팬 · 센서', feature: 'Sensors 컬렉션(전압·전류·전력…)', fn: 'fetchSensorCollection', path: '/Chassis/{id}/Sensors', dell: ['ok', '$expand 지원(The.DVC 주석 — 미확인)'] },
  { id: 'storage', group: '부품', feature: '디스크 · RAID 컨트롤러', fn: 'fetchInventory', path: '/Systems/{id}/Storage', dell: ['ok', 'PERC · 드라이브'] },
  { id: 'memory', group: '부품', feature: '메모리 DIMM', fn: 'fetchInventory', path: '/Systems/{id}/Memory', dell: ['ok', 'DIMM.Socket.A1 형식'] },
  { id: 'processors', group: '부품', feature: 'CPU · GPU', fn: 'fetchInventory', path: '/Systems/{id}/Processors', dell: ['ok', ''] },
  { id: 'nics', group: '부품', feature: 'NIC 어댑터 · 포트', fn: 'fetchInventory', path: '/Chassis/{id}/NetworkAdapters', dell: ['ok', 'NIC.Integrated.1-1 형식'] },
  { id: 'pcie', group: '부품', feature: 'PCIe 장치', fn: 'fetchInventory', path: '/Systems/{id}/PCIeDevices', dell: ['ok', ''] },
  { id: 'logs', group: '로그 · 펌웨어 · 설정', feature: '하드웨어 이벤트 로그', fn: 'fetchInventory', path: '…/LogServices/*/Entries', dell: ['ok', 'Sel · Lclog'] },
  { id: 'firmware', group: '로그 · 펌웨어 · 설정', feature: '펌웨어 목록', fn: 'fetchFirmwareInventory', path: '/UpdateService/FirmwareInventory', dell: ['ok', 'Installed-* 멤버'] },
  { id: 'licenses', group: '로그 · 펌웨어 · 설정', feature: 'BMC 라이선스', fn: 'fetchInventory · bmusage/license', path: '/LicenseService · Oem', dell: ['ok', 'LicenseService · DellLicenses'] },
  { id: 'bios', group: '로그 · 펌웨어 · 설정', feature: 'BIOS 속성', fn: 'fetchInventory', path: '/Systems/{id}/Bios', dell: ['ok', 'BIOS_KEYS 19개'] },
  { id: 'secureBoot', group: '로그 · 펌웨어 · 설정', feature: 'Secure Boot', fn: 'fetchInventory(존재만)', path: '/Systems/{id}/SecureBoot', dell: ['ok', ''] },
  { id: 'telemetry', group: '사용률', feature: 'CPU·메모리·IO 사용률(텔레메트리)', fn: 'fetchUsage', path: '/TelemetryService/MetricReports', dell: ['ok', 'Datacenter 라이선스일 때'] },
  { id: 'usageSensors', group: '사용률', feature: '사용률 센서(Enterprise 대체)', fn: 'fetchUsageSensors', path: '/Chassis/{id}/Sensors(이름 패턴)', dell: ['partial', '실장비 미확인(The.DVC 주석)'] },
  { id: 'gpuMetrics', group: '사용률', feature: 'GPU 지표(ProcessorMetrics)', fn: 'probeGpuTelemetry', path: '/Processors/{id}/ProcessorMetrics', dell: ['partial', 'Datacenter + 지원 GPU'] },
  { id: 'racadm', group: '사용률', feature: 'racadm SSH 대체 경로', fn: 'idracEnterprise', path: 'SSH racadm systemperfstatistics', dell: ['ok', 'Enterprise 라이선스 대체'] },
  { id: 'eventService', group: '기타(PoC 추가)', feature: '이벤트 구독 서비스', fn: '— (PoC 추가)', path: '/EventService', dell: ['ok', 'The.DVC 미사용'] },
  { id: 'virtualMedia', group: '기타(PoC 추가)', feature: '가상 미디어', fn: '— (PoC 추가)', path: '/Managers/{id}/VirtualMedia', dell: ['ok', 'The.DVC 미사용'] },
  { id: 'oem', group: '기타(PoC 추가)', feature: 'Oem 확장 자원', fn: '— (PoC 추가)', path: 'Oem.* (전체 탐색 기준)', dell: ['ok', 'Oem.Dell'] },
];

export const CHECK_BY_ID = Object.fromEntries(CHECKS.map((c) => [c.id, c]));

const CAP = { systems: 4, chassis: 8, psu: 16, storage: 8, ctrl: 16, drives: 48, dimms: 64, procs: 24, gpus: 8, adapters: 12, ports: 32, pcie: 32, logServices: 8, logEntries: 30, fw: 150, lic: 12, accounts: 32, reports: 8, vm: 8, sensorsPerChassis: 4 };
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const s = (v) => (v == null ? '' : typeof v === 'object' ? '' : String(v));
const health = (o) => s(o?.Status?.Health);
const state = (o) => s(o?.Status?.State);
const tail = (p) => String(p || '').split('?')[0].split('/').filter(Boolean).pop() || '';
const result = (status, note, data, evidence) => ({ status, note: note || '', data: data || {}, evidence: evidence || [] });

/** 컬렉션 하나를 읽고 멤버를 상한까지 GET. */
async function readMembers(g, collPath, cap) {
  const coll = await g(collPath);
  if (coll.kind !== 'ok') return { coll, items: [], total: 0 };
  const ids = membersOf(coll.json);
  const items = [];
  for (const id of ids.slice(0, cap)) items.push(await g(id));
  return { coll, items, total: ids.length };
}

/** 병렬 GET(동시 n) — 한 BMC 에 보내는 동시 요청을 작게 유지한다. */
async function mapLimit(list, n, fn) {
  const out = new Array(list.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) { const k = i++; out[k] = await fn(list[k], k); }
  });
  await Promise.all(workers);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
const IMPL = {
  async serviceRoot(ctx) {
    const r = ctx.rootNoAuth;
    const ev = r ? [{ path: '/redfish/v1', status: r.status, kind: r.kind }] : [];
    if (!r || r.kind === 'error') return result('error', r?.note || '서비스 루트 응답 없음', {}, ev);
    const root = r.json || {};
    const sys = ctx.cache.get(ctx.sysIds[0])?.json;
    const v = classifyBmcVendor({ root, manufacturer: sys?.Manufacturer, model: sys?.Model });
    const data = {
      RedfishVersion: s(root.RedfishVersion), Vendor: s(root.Vendor), Product: s(root.Product), Name: s(root.Name),
      UUID: s(root.UUID), oemKeys: root.Oem && typeof root.Oem === 'object' ? Object.keys(root.Oem) : [],
      vendor: v.vendor, vendorLabel: v.label, vendorEvidence: v.evidence, dvcScan: dvcScanOutcome(v.vendor).label,
      services: Object.keys(root).filter((k) => root[k] && typeof root[k] === 'object' && root[k]['@odata.id']),
    };
    if (r.kind === 'auth') return result('partial', '서비스 루트도 인증을 요구함(규격상 무인증) — 벤더는 인증 후 정보로 판별', data, ev);
    if (r.kind !== 'ok') return result(r.kind, r.note, data, ev);
    return result('ok', `${v.label}${v.evidence ? ` (${v.evidence})` : ''} · Redfish ${data.RedfishVersion || '?'}`, data, ev);
  },

  async system(ctx) {
    const { get, evidence } = ctx.scope();
    const coll = await get('/redfish/v1/Systems');
    if (coll.kind !== 'ok') return result(coll.kind, coll.note, {}, evidence);
    if (!ctx.sysIds.length) return result('empty', 'Systems 멤버 0개', {}, evidence);
    const systems = [];
    for (const id of ctx.sysIds.slice(0, CAP.systems)) {
      const r = await get(id);
      if (r.kind !== 'ok') { systems.push({ path: id, error: r.note, kind: r.kind }); continue; }
      const x = r.json;
      systems.push({
        path: id, Id: s(x.Id), Manufacturer: s(x.Manufacturer), Model: s(x.Model), SKU: s(x.SKU), SerialNumber: s(x.SerialNumber),
        PartNumber: s(x.PartNumber), UUID: s(x.UUID), AssetTag: s(x.AssetTag), BiosVersion: s(x.BiosVersion), PowerState: s(x.PowerState),
        HostName: s(x.HostName), SystemType: s(x.SystemType), Health: health(x), HealthRollup: s(x.Status?.HealthRollup), IndicatorLED: s(x.IndicatorLED || x.LocationIndicatorActive),
        cpuCount: num(x.ProcessorSummary?.Count), cpuModel: s(x.ProcessorSummary?.Model).trim(), cpuCores: num(x.ProcessorSummary?.CoreCount), cpuThreads: num(x.ProcessorSummary?.LogicalProcessorCount),
        memoryGiB: num(x.MemorySummary?.TotalSystemMemoryGiB), bootMode: s(x.Boot?.BootSourceOverrideMode), bootTarget: s(x.Boot?.BootSourceOverrideTarget),
        bootOrderCount: Array.isArray(x.Boot?.BootOrder) ? x.Boot.BootOrder.length : null,
        oemKeys: x.Oem && typeof x.Oem === 'object' ? Object.keys(x.Oem) : [],
      });
    }
    const p = systems.find((x) => !x.error);
    if (!p) return result(systems[0]?.kind || 'error', systems[0]?.error || '', { systems }, evidence);
    const dvcTag = systemServiceTag(ctx.cache.get(p.path)?.json, '');
    const data = {
      ...p, systems, systemsCount: ctx.sysIds.length,
      dvcServiceTag: dvcTag, dvcServiceTagFrom: p.SKU ? 'SKU' : (p.SerialNumber ? 'SerialNumber' : '—'),
      skuPlaceholder: isPlaceholder(p.SKU), serialPlaceholder: isPlaceholder(p.SerialNumber),
    };
    const missing = ['Model', 'SerialNumber', 'UUID'].filter((k) => !p[k]);
    const note = `${[p.Manufacturer, p.Model].filter(Boolean).join(' ')} · SN ${p.SerialNumber || '—'} · SKU ${p.SKU || '—'}`;
    return result(missing.length ? 'partial' : 'ok', missing.length ? `${note} · 빠짐: ${missing.join(', ')}` : note, data, evidence);
  },

  async manager(ctx) {
    const { get, evidence } = ctx.scope();
    const coll = await get('/redfish/v1/Managers');
    if (coll.kind !== 'ok') return result(coll.kind, coll.note, {}, evidence);
    const mid = ctx.mgrIds[0];
    if (!mid) return result('empty', 'Managers 멤버 0개', {}, evidence);
    const r = await get(mid);
    if (r.kind !== 'ok') return result(r.kind, r.note, {}, evidence);
    const m = r.json;
    const data = {
      path: mid, Id: s(m.Id), FirmwareVersion: s(m.FirmwareVersion), Model: s(m.Model), ManagerType: s(m.ManagerType), DateTime: s(m.DateTime),
      DateTimeLocalOffset: s(m.DateTimeLocalOffset), UUID: s(m.UUID), Health: health(m), PowerState: s(m.PowerState),
      oemKeys: m.Oem && typeof m.Oem === 'object' ? Object.keys(m.Oem) : [], managersCount: ctx.mgrIds.length, interfaces: [],
    };
    const eth = linkOf(m, 'EthernetInterfaces');
    if (eth) {
      const { items } = await readMembers(get, eth, 4);
      for (const it of items) {
        if (it.kind !== 'ok') continue;
        const e = it.json;
        data.interfaces.push({
          Id: s(e.Id), MACAddress: s(e.MACAddress || e.PermanentMACAddress), HostName: s(e.HostName), FQDN: s(e.FQDN),
          IPv4: (e.IPv4Addresses || []).map((a) => s(a?.Address)).filter(Boolean).join(', '), IPv6Count: (e.IPv6Addresses || []).length,
          SpeedMbps: num(e.SpeedMbps), LinkStatus: s(e.LinkStatus), VLAN: e.VLAN?.VLANEnable ? num(e.VLAN?.VLANId) : null,
        });
      }
    }
    return result(data.FirmwareVersion ? 'ok' : 'partial', `${data.Model || 'BMC'} · FW ${data.FirmwareVersion || '—'} · NIC ${data.interfaces.length}`, data, evidence);
  },

  async networkProtocol(ctx) {
    const { get, evidence } = ctx.scope();
    const mid = ctx.mgrIds[0];
    if (!mid) return result('skip', 'Manager 없음', {}, evidence);
    const r = await get(`${mid}/NetworkProtocol`);
    if (r.kind !== 'ok') return result(r.kind, r.note, {}, evidence);
    const n = r.json;
    const protos = {};
    for (const k of ['HTTP', 'HTTPS', 'SSH', 'IPMI', 'SNMP', 'KVMIP', 'VirtualMedia', 'NTP', 'SSDP', 'Telnet', 'DHCP', 'RFB']) {
      if (n[k] && typeof n[k] === 'object') protos[k] = { enabled: n[k].ProtocolEnabled ?? null, port: num(n[k].Port) };
    }
    const ipmi = protos.IPMI;
    return result('ok', ipmi ? `IPMI over LAN ${ipmi.enabled === false ? '꺼짐' : ipmi.enabled ? '켜짐' : '?'}${ipmi.port ? ` · ${ipmi.port}` : ''}` : 'IPMI 항목 없음',
      { HostName: s(n.HostName), FQDN: s(n.FQDN), protocols: protos, oemKeys: n.Oem ? Object.keys(n.Oem) : [] }, evidence);
  },

  async accounts(ctx) {
    const { get, evidence } = ctx.scope();
    const svc = await get('/redfish/v1/AccountService');
    const data = { policy: {}, accounts: [], roles: [] };
    if (svc.kind === 'ok') {
      const a = svc.json;
      data.policy = {
        AccountLockoutThreshold: num(a.AccountLockoutThreshold), AccountLockoutDuration: num(a.AccountLockoutDuration),
        AccountLockoutCounterResetAfter: num(a.AccountLockoutCounterResetAfter), MinPasswordLength: num(a.MinPasswordLength),
        MaxPasswordLength: num(a.MaxPasswordLength), LocalAccountAuth: s(a.LocalAccountAuth), ServiceEnabled: a.ServiceEnabled ?? null,
      };
    }
    const accPath = (svc.kind === 'ok' && linkOf(svc.json, 'Accounts')) || '/redfish/v1/AccountService/Accounts';
    const { coll, items, total } = await readMembers(get, accPath, CAP.accounts);
    for (const it of items) {
      if (it.kind !== 'ok' || !it.json?.UserName) continue;
      data.accounts.push({ Id: s(it.json.Id), UserName: s(it.json.UserName), RoleId: s(it.json.RoleId || it.json.Role), Enabled: it.json.Enabled !== false, Locked: it.json.Locked ?? null });
    }
    data.slots = total;
    if (coll.kind !== 'ok') return result(svc.kind === 'ok' ? 'partial' : coll.kind, coll.note, data, evidence);
    const lock = data.policy.AccountLockoutThreshold;
    return result('ok', `계정 ${data.accounts.length}개 · 잠금 임계 ${lock == null ? '—' : lock === 0 ? '없음' : `${lock}회`}`, data, evidence);
  },

  async power(ctx) {
    const { get, evidence } = ctx.scope();
    if (!ctx.chassisIds.length) return result(ctx.cache.get('/redfish/v1/Chassis')?.kind === 'ok' ? 'empty' : (ctx.cache.get('/redfish/v1/Chassis')?.kind || 'error'), 'Chassis 없음', {}, evidence);
    const per = [];
    let total = null;
    const kinds = [];
    for (const cid of ctx.chassisIds.slice(0, CAP.chassis)) {
      const r = await get(`${cid}/Power`);
      kinds.push(r.kind);
      if (r.kind !== 'ok') { per.push({ chassis: tail(cid), kind: r.kind, note: r.note }); continue; }
      const ctrls = (r.json.PowerControl || []).map((pc) => ({
        name: s(pc.Name || pc.MemberId), consumed: num(pc.PowerConsumedWatts), capacity: num(pc.PowerCapacityWatts),
        avg: num(pc.PowerMetrics?.AverageConsumedWatts), min: num(pc.PowerMetrics?.MinConsumedWatts), max: num(pc.PowerMetrics?.MaxConsumedWatts),
        interval: num(pc.PowerMetrics?.IntervalInMin), limit: num(pc.PowerLimit?.LimitInWatts), limitException: s(pc.PowerLimit?.LimitException),
        context: s(pc.PhysicalContext),
      }));
      let w = null;
      for (const c of ctrls) if (c.consumed != null) w = (w || 0) + c.consumed;
      if (w != null) total = (total || 0) + w;
      per.push({ chassis: tail(cid), kind: 'ok', watts: w, controls: ctrls, voltages: (r.json.Voltages || []).length, psus: (r.json.PowerSupplies || []).length });
    }
    const withWatts = per.filter((p) => p.watts != null).length;
    const data = { perChassis: per, dvcTotalWatts: total, chassisWithWatts: withWatts };
    if (total != null) {
      const failed = per.filter((p) => p.kind !== 'ok' && p.kind !== 'absent').length;
      return result(failed ? 'partial' : 'ok', `${Math.round(total)} W${withWatts > 1 ? ` (섀시 ${withWatts}개 합산)` : ''}${failed ? ` · 섀시 ${failed}개 실패` : ''}`, data, evidence);
    }
    if (kinds.includes('ok')) return result('partial', 'Power 자원은 있으나 PowerConsumedWatts 값이 없음', data, evidence);
    return result(bestOf(kinds), per[0]?.note || '', data, evidence);
  },

  async psu(ctx) {
    const { get, evidence } = ctx.scope();
    const psus = [];
    const kinds = [];
    for (const cid of ctx.chassisIds.slice(0, CAP.chassis)) {
      const r = await get(`${cid}/Power`);
      kinds.push(r.kind);
      if (r.kind !== 'ok') continue;
      for (const p of (r.json.PowerSupplies || []).slice(0, CAP.psu)) {
        psus.push({
          chassis: tail(cid), Name: s(p.Name || p.MemberId), Model: s(p.Model), Manufacturer: s(p.Manufacturer), SerialNumber: s(p.SerialNumber),
          PartNumber: s(p.PartNumber), FirmwareVersion: s(p.FirmwareVersion), PowerCapacityWatts: num(p.PowerCapacityWatts),
          LineInputVoltage: num(p.LineInputVoltage), PowerInputWatts: num(p.PowerInputWatts), PowerOutputWatts: num(p.PowerOutputWatts ?? p.LastPowerOutputWatts),
          PowerSupplyType: s(p.PowerSupplyType), Health: health(p), State: state(p), Redundancy: Array.isArray(p.Redundancy) && p.Redundancy.length > 0,
        });
      }
    }
    if (psus.length) {
      const bad = psus.filter((p) => p.Health && p.Health !== 'OK').length;
      return result('ok', `PSU ${psus.length}개${bad ? ` · 이상 ${bad}` : ''}`, { psus }, evidence);
    }
    if (kinds.includes('ok')) return result('empty', 'PowerSupplies 0개', { psus }, evidence);
    return result(bestOf(kinds), '', { psus }, evidence);
  },

  async powerSubsystem(ctx) {
    const { get, evidence } = ctx.scope();
    const kinds = [];
    const per = [];
    for (const cid of ctx.chassisIds.slice(0, CAP.chassis)) {
      const r = await get(`${cid}/PowerSubsystem`);
      kinds.push(r.kind);
      if (r.kind !== 'ok') continue;
      const ps = linkOf(r.json, 'PowerSupplies');
      let count = null;
      const supplies = [];
      if (ps) {
        const { items, total } = await readMembers(get, ps, CAP.psu);
        count = total;
        for (const it of items) if (it.kind === 'ok') supplies.push({ Name: s(it.json.Name), Model: s(it.json.Model), SerialNumber: s(it.json.SerialNumber), Health: health(it.json), CapacityW: num(it.json.PowerCapacityWatts) });
      }
      const env = await get(`${cid}/EnvironmentMetrics`);
      per.push({
        chassis: tail(cid), CapacityWatts: num(r.json.CapacityWatts), AllocatedWatts: num(r.json.Allocation?.AllocatedWatts),
        powerSupplies: count, supplies, envPowerWatts: env.kind === 'ok' ? num(env.json.PowerWatts?.Reading) : null,
        envTempC: env.kind === 'ok' ? num(env.json.TemperatureCelsius?.Reading) : null,
      });
    }
    if (per.length) return result('ok', `섀시 ${per.length}개 · PSU ${per.reduce((a, p) => a + (p.powerSupplies || 0), 0)}`, { perChassis: per }, evidence);
    return result(ctx.chassisIds.length ? bestOf(kinds) : 'skip', ctx.chassisIds.length ? '' : 'Chassis 없음', { perChassis: per }, evidence);
  },

  async thermal(ctx) {
    const { get, evidence } = ctx.scope();
    const temps = [];
    const kinds = [];
    let absentSensors = 0;
    for (const cid of ctx.chassisIds.slice(0, CAP.chassis)) {
      const r = await get(`${cid}/Thermal`);
      kinds.push(r.kind);
      if (r.kind !== 'ok') continue;
      for (const t of r.json.Temperatures || []) {
        if (state(t).toLowerCase() === 'absent') { absentSensors += 1; continue; }
        const name = s(t.Name || t.MemberId) || `Sensor ${s(t.SensorNumber)}`;
        temps.push({
          chassis: tail(cid), name, reading: num(t.ReadingCelsius), health: health(t), state: state(t), context: s(t.PhysicalContext),
          upperWarn: num(t.UpperThresholdNonCritical), upperCrit: num(t.UpperThresholdCritical), upperFatal: num(t.UpperThresholdFatal),
          lowerWarn: num(t.LowerThresholdNonCritical), lowerCrit: num(t.LowerThresholdCritical), dvcRoom: classifyRoomSensor(name),
        });
      }
    }
    const withVal = temps.filter((t) => t.reading != null);
    const inlet = temps.filter((t) => t.dvcRoom === 'inlet');
    const data = {
      temps, absentSensors, count: temps.length, maxC: withVal.length ? Math.max(...withVal.map((t) => t.reading)) : null,
      dvcInlet: inlet.map((t) => t.name), dvcCpu: temps.filter((t) => t.dvcRoom === 'cpu').map((t) => t.name), dvcExhaust: temps.filter((t) => t.dvcRoom === 'exhaust').map((t) => t.name),
    };
    if (temps.length) return result(kinds.some((k) => k !== 'ok' && k !== 'absent') ? 'partial' : 'ok', `온도 ${temps.length}개 · 최고 ${data.maxC ?? '—'}°C · 흡기 판정 ${inlet.length}개`, data, evidence);
    if (kinds.includes('ok')) return result('empty', '온도 센서 0개', data, evidence);
    return result(ctx.chassisIds.length ? bestOf(kinds) : 'skip', '', data, evidence);
  },

  async fans(ctx) {
    const { get, evidence } = ctx.scope();
    const fans = [];
    const kinds = [];
    for (const cid of ctx.chassisIds.slice(0, CAP.chassis)) {
      const r = await get(`${cid}/Thermal`);
      kinds.push(r.kind);
      if (r.kind !== 'ok') continue;
      for (const f of r.json.Fans || []) {
        fans.push({
          chassis: tail(cid), name: s(f.Name || f.FanName || f.MemberId), reading: num(f.Reading ?? f.ReadingRPM), units: s(f.ReadingUnits) || (f.ReadingRPM != null ? 'RPM' : ''),
          health: health(f), state: state(f), lowerCrit: num(f.LowerThresholdCritical), redundancy: Array.isArray(f.Redundancy) && f.Redundancy.length > 0,
          model: s(f.Model), partNumber: s(f.PartNumber),
        });
      }
    }
    const units = [...new Set(fans.map((f) => f.units).filter(Boolean))];
    if (fans.length) return result('ok', `팬 ${fans.length}개 · 단위 ${units.join('/') || '—'} · 빈 슬롯 ${fans.filter((f) => f.state.toLowerCase() === 'absent').length}`, { fans, units }, evidence);
    if (kinds.includes('ok')) return result('empty', '팬 0개', { fans, units }, evidence);
    return result(ctx.chassisIds.length ? bestOf(kinds) : 'skip', '', { fans, units }, evidence);
  },

  async thermalSubsystem(ctx) {
    const { get, evidence } = ctx.scope();
    const kinds = [];
    const per = [];
    for (const cid of ctx.chassisIds.slice(0, CAP.chassis)) {
      const r = await get(`${cid}/ThermalSubsystem`);
      kinds.push(r.kind);
      if (r.kind !== 'ok') continue;
      const fl = linkOf(r.json, 'Fans');
      let fans = null;
      const fanList = [];
      if (fl) {
        const { items, total } = await readMembers(get, fl, 16);
        fans = total;
        for (const it of items) if (it.kind === 'ok') fanList.push({ Name: s(it.json.Name), SpeedPercent: num(it.json.SpeedPercent?.Reading), SpeedRPM: num(it.json.SpeedPercent?.SpeedRPM), Health: health(it.json) });
      }
      const tm = linkOf(r.json, 'ThermalMetrics');
      let readings = null;
      if (tm) { const t = await get(tm); if (t.kind === 'ok') readings = (t.json.TemperatureReadingsCelsius || []).length; }
      per.push({ chassis: tail(cid), fans, fanList, temperatureReadings: readings });
    }
    if (per.length) return result('ok', `섀시 ${per.length}개 · 팬 ${per.reduce((a, p) => a + (p.fans || 0), 0)} · 온도 ${per.reduce((a, p) => a + (p.temperatureReadings || 0), 0)}`, { perChassis: per }, evidence);
    return result(ctx.chassisIds.length ? bestOf(kinds) : 'skip', '', { perChassis: per }, evidence);
  },

  async sensors(ctx, opts) {
    const { get, evidence } = ctx.scope();
    const list = [];
    const per = [];
    const kinds = [];
    let budget = opts?.sensorMemberCap ?? 300;
    let notRead = 0;
    const parse = (o, cid, link) => ({
      chassis: tail(cid), id: s(o.Id) || tail(link), name: s(o.Name) || s(o.Id) || tail(link), reading: num(o.Reading), units: s(o.ReadingUnits),
      type: s(o.ReadingType), context: s(o.PhysicalContext), health: health(o), state: state(o),
      upperCrit: num(o.Thresholds?.UpperCritical?.Reading), upperCaution: num(o.Thresholds?.UpperCaution?.Reading),
    });
    for (const cid of ctx.chassisIds.slice(0, CAP.sensorsPerChassis)) {
      let r = await get(`${cid}/Sensors?$expand=*($levels=1)`);
      let expandTried = true;
      if (r.kind !== 'ok' && r.kind !== 'absent' && r.kind !== 'auth') { r = await get(`${cid}/Sensors`); expandTried = false; }
      kinds.push(r.kind);
      if (r.kind !== 'ok') { per.push({ chassis: tail(cid), kind: r.kind, note: r.note }); continue; }
      const members = Array.isArray(r.json.Members) ? r.json.Members : [];
      const expanded = members.length > 0 && members.every((m) => m && typeof m === 'object' && (m.Reading !== undefined || m.ReadingType !== undefined || m.Name !== undefined));
      if (expanded) {
        for (const m of members) list.push(parse(m, cid, m['@odata.id']));
      } else {
        const links = membersOf(r.json);
        const take = links.slice(0, Math.max(0, budget));
        notRead += links.length - take.length;
        budget -= take.length;
        const got = await mapLimit(take, 3, (l) => get(l));
        for (let i = 0; i < got.length; i++) {
          if (got[i].kind === 'ok') list.push(parse(got[i].json, cid, take[i])); else notRead += 1;
        }
      }
      per.push({ chassis: tail(cid), kind: 'ok', members: members.length, expandSupported: expandTried && expanded });
    }
    const byType = {};
    for (const x of list) { const k = x.type || x.units || '기타'; byType[k] = (byType[k] || 0) + 1; }
    const data = { sensors: list.slice(0, 600), count: list.length, byType, perChassis: per, notRead };
    if (list.length) return result(notRead ? 'partial' : 'ok', `센서 ${list.length}개 · ${Object.entries(byType).map(([k, v]) => `${k} ${v}`).slice(0, 5).join(' · ')}${per.some((p) => p.expandSupported) ? ' · $expand 지원' : ' · 개별 GET'}${notRead ? ` · 못 읽음 ${notRead}` : ''}`, data, evidence);
    if (kinds.includes('ok')) return result('empty', 'Sensors 멤버 0개', data, evidence);
    return result(ctx.chassisIds.length ? bestOf(kinds) : 'skip', per[0]?.note || '', data, evidence);
  },

  async usageSensors(ctx, opts, done) {
    const sn = done.sensors;
    if (!sn || !['ok', 'partial'].includes(sn.status)) {
      return result(sn?.status === 'empty' ? 'empty' : (sn?.status || 'skip'), 'Sensors 컬렉션을 읽지 못함 — 대체 경로 판정 불가', {}, sn?.evidence || []);
    }
    const found = {};
    for (const x of sn.data.sensors || []) {
      const field = sensorFieldOf(x.id) || sensorFieldOf(x.name);
      if (!field || found[field]) continue;
      if (x.reading == null || x.reading < 0 || x.reading > 100) continue;
      found[field] = { name: x.name, id: x.id, value: x.reading };
    }
    const keys = Object.keys(found);
    if (!keys.length) return result('empty', `센서 ${sn.data.count}개 중 The.DVC 사용률 이름 패턴(cpu.*usage 등)이 맞는 것 0개`, { found }, sn.evidence);
    return result('ok', keys.map((k) => `${k.replace('Pct', '')} ${found[k].value}%`).join(' · '), { found }, sn.evidence);
  },

  async storage(ctx) {
    const { get, evidence } = ctx.scope();
    const sid = ctx.sysIds[0];
    if (!sid) return result('skip', 'System 없음', {}, evidence);
    const coll = await get(`${sid}/Storage`);
    const data = { controllers: [], drives: [], volumes: 0, members: [], simpleStorage: null };
    const simple = await get(`${sid}/SimpleStorage`);
    if (simple.kind === 'ok') data.simpleStorage = { members: membersOf(simple.json).length };
    if (coll.kind !== 'ok') return result(coll.kind, coll.note, data, evidence);
    const ids = membersOf(coll.json);
    const memberKinds = [];
    let driveBudget = CAP.drives;
    for (const id of ids.slice(0, CAP.storage)) {
      const r = await get(id);
      memberKinds.push(r.kind);
      data.members.push({ id: tail(id), kind: r.kind, note: r.note });
      if (r.kind !== 'ok') continue;
      const st = r.json;
      for (const sc of (st.StorageControllers || []).slice(0, CAP.ctrl)) {
        data.controllers.push({ storage: tail(id), Name: s(sc.Name || st.Name), Model: s(sc.Model).trim(), Manufacturer: s(sc.Manufacturer), FirmwareVersion: s(sc.FirmwareVersion), SpeedGbps: num(sc.SpeedGbps), Protocols: (sc.SupportedDeviceProtocols || []).join('/'), Health: health(sc) });
      }
      const cl = linkOf(st, 'Controllers');
      if (cl && !(st.StorageControllers || []).length) {
        const { items } = await readMembers(get, cl, CAP.ctrl);
        for (const it of items) if (it.kind === 'ok') data.controllers.push({ storage: tail(id), Name: s(it.json.Name), Model: s(it.json.Model).trim(), Manufacturer: s(it.json.Manufacturer), FirmwareVersion: s(it.json.FirmwareVersion), SpeedGbps: num(it.json.SpeedGbps), Protocols: (it.json.SupportedControllerProtocols || []).join('/'), Health: health(it.json) });
      }
      const vl = linkOf(st, 'Volumes');
      if (vl) { const v = await get(vl); if (v.kind === 'ok') data.volumes += membersOf(v.json).length; }
      for (const d of (st.Drives || []).map((x) => x?.['@odata.id']).filter(Boolean)) {
        if (driveBudget-- <= 0) break;
        const dr = await get(d);
        if (dr.kind !== 'ok') { data.drives.push({ path: d, kind: dr.kind, note: dr.note }); continue; }
        const x = dr.json;
        data.drives.push({
          storage: tail(id), Name: s(x.Name || x.Id), Model: s(x.Model), SerialNumber: s(x.SerialNumber), Manufacturer: s(x.Manufacturer),
          capacityGB: num(x.CapacityBytes) != null ? Math.round(x.CapacityBytes / 1e9) : null, MediaType: s(x.MediaType), Protocol: s(x.Protocol),
          FailurePredicted: x.FailurePredicted == null ? null : !!x.FailurePredicted, LifeLeftPct: num(x.PredictedMediaLifeLeftPercent),
          RPM: num(x.RotationSpeedRPM), Revision: s(x.Revision), Health: health(x), State: state(x),
        });
      }
    }
    if (!ids.length) return result('empty', 'Storage 멤버 0개', data, evidence);
    const okMembers = memberKinds.filter((k) => k === 'ok').length;
    if (!okMembers) return result(bestOf(memberKinds), data.members[0]?.note || '', data, evidence);
    const okDrives = data.drives.filter((d) => !d.kind).length;
    const note = `컨트롤러 ${data.controllers.length} · 드라이브 ${okDrives} · 볼륨 ${data.volumes}${okMembers < ids.length ? ` · 멤버 ${ids.length - okMembers}개 읽지 못함` : ''}`;
    return result(okMembers < ids.length || data.drives.some((d) => d.kind) ? 'partial' : 'ok', note, data, evidence);
  },

  async memory(ctx) {
    const { get, evidence } = ctx.scope();
    const sid = ctx.sysIds[0];
    if (!sid) return result('skip', 'System 없음', {}, evidence);
    const { coll, items, total } = await readMembers(get, `${sid}/Memory`, CAP.dimms);
    if (coll.kind !== 'ok') return result(coll.kind, coll.note, {}, evidence);
    const dimms = [];
    let absent = 0;
    for (const it of items) {
      if (it.kind !== 'ok') continue;
      const d = it.json;
      if (state(d).toLowerCase() === 'absent' || (!d.CapacityMiB && !d.Status)) { absent += 1; continue; }
      dimms.push({
        Id: s(d.Id), locator: s(d.DeviceLocator || d.Name || d.Id), sizeGB: num(d.CapacityMiB) != null ? Math.round(d.CapacityMiB / 1024) : null,
        speedMHz: num(d.OperatingSpeedMhz), type: s(d.MemoryDeviceType), Manufacturer: s(d.Manufacturer), PartNumber: s(d.PartNumber).trim(),
        SerialNumber: s(d.SerialNumber), RankCount: num(d.RankCount), ErrorCorrection: s(d.ErrorCorrection), Health: health(d), State: state(d),
      });
    }
    const totalGB = dimms.reduce((a, d) => a + (d.sizeGB || 0), 0);
    if (!total) return result('empty', 'Memory 멤버 0개', { dimms, absent }, evidence);
    return result(dimms.length ? 'ok' : 'partial', `DIMM ${dimms.length}개 · ${totalGB} GB · 빈 슬롯 ${absent}${total > CAP.dimms ? ` · ${total - CAP.dimms}개 생략` : ''}`, { dimms, absent, slots: total, totalGB }, evidence);
  },

  async processors(ctx) {
    const { get, evidence } = ctx.scope();
    const sid = ctx.sysIds[0];
    if (!sid) return result('skip', 'System 없음', {}, evidence);
    const { coll, items, total } = await readMembers(get, `${sid}/Processors`, CAP.procs);
    if (coll.kind !== 'ok') return result(coll.kind, coll.note, {}, evidence);
    const cpus = [];
    const gpus = [];
    for (const it of items) {
      if (it.kind !== 'ok') continue;
      const p = it.json;
      const rec = {
        path: it.path, Id: s(p.Id), Socket: s(p.Socket), ProcessorType: s(p.ProcessorType), Model: s(p.Model).trim(), Manufacturer: s(p.Manufacturer),
        TotalCores: num(p.TotalCores), TotalThreads: num(p.TotalThreads), MaxSpeedMHz: num(p.MaxSpeedMHz), Health: health(p), State: state(p),
      };
      if (isGpuProcessor(p)) gpus.push(rec); else if (state(p).toLowerCase() !== 'absent') cpus.push(rec);
    }
    if (!total) return result('empty', 'Processors 멤버 0개', { cpus, gpus }, evidence);
    return result('ok', `CPU ${cpus.length}${cpus[0]?.Model ? ` (${cpus[0].Model})` : ''} · GPU ${gpus.length}`, { cpus, gpus }, evidence);
  },

  async gpuMetrics(ctx, opts, done) {
    const { get, evidence } = ctx.scope();
    const gpus = done.processors?.data?.gpus || [];
    if (!gpus.length) return result('skip', 'Processors 에 GPU 없음(없거나 BMC 가 GPU 를 Processor 로 보이지 않음)', {}, evidence);
    const out = [];
    const kinds = [];
    for (const g of gpus.slice(0, CAP.gpus)) {
      const r = await get(`${g.path}/ProcessorMetrics`);
      kinds.push(r.kind);
      if (r.kind !== 'ok') { out.push({ gpu: g.Id, kind: r.kind }); continue; }
      const m = r.json;
      const fields = Object.entries(m).filter(([k, v]) => typeof v === 'number' || (v && typeof v === 'object' && typeof v.Reading === 'number')).map(([k]) => k);
      const oem = m.Oem && typeof m.Oem === 'object' ? Object.keys(m.Oem) : [];
      out.push({ gpu: g.Id, kind: 'ok', fields, oem, util: /util|usage|bandwidth/i.test(fields.join(' ') + JSON.stringify(m.Oem || {})) });
    }
    if (out.some((x) => x.util)) return result('ok', `GPU ${gpus.length}개 · 사용률 성격 필드 있음`, { gpus: out }, evidence);
    if (kinds.includes('ok')) return result('partial', 'ProcessorMetrics 는 있으나 사용률 필드 없음', { gpus: out }, evidence);
    return result(bestOf(kinds), `GPU ${gpus.length}개 · ProcessorMetrics ${bestOf(kinds)}`, { gpus: out }, evidence);
  },

  async nics(ctx) {
    const { get, evidence } = ctx.scope();
    const adapters = [];
    const kinds = [];
    for (const cid of ctx.chassisIds.slice(0, 6)) {
      const na = await get(`${cid}/NetworkAdapters`);
      kinds.push(na.kind);
      if (na.kind !== 'ok') continue;
      for (const am of membersOf(na.json).slice(0, CAP.adapters)) {
        const a = await get(am);
        if (a.kind !== 'ok') { adapters.push({ path: am, kind: a.kind, note: a.note, ports: [] }); continue; }
        const links = new Set();
        for (const l of [linkOf(a.json, 'NetworkPorts'), linkOf(a.json, 'Ports')]) if (l) links.add(l);
        for (const ctl of a.json.Controllers || []) for (const arr of [ctl.Links?.NetworkPorts, ctl.Links?.Ports]) for (const ref of arr || []) if (ref?.['@odata.id']) links.add(ref['@odata.id']);
        const portRefs = [];
        for (const l of links) { const r = await get(l); if (r.kind !== 'ok') continue; if (Array.isArray(r.json.Members)) portRefs.push(...membersOf(r.json)); else portRefs.push(r.path); }
        const ports = [];
        for (const pr of [...new Set(portRefs)].slice(0, CAP.ports)) {
          const p = await get(pr);
          if (p.kind !== 'ok') continue;
          const x = p.json;
          ports.push({
            id: s(x.Id || x.Name), link: s(x.LinkStatus || x.LinkState || x.Status?.State), speedMbps: nicPortSpeedMbps(x),
            mac: s((x.AssociatedNetworkAddresses || [])[0] || (x.Ethernet?.AssociatedMACAddresses || [])[0]), portType: s(x.PortType || x.PortProtocol || x.ActiveLinkTechnology),
          });
        }
        adapters.push({
          Id: s(a.json.Id), Model: s(a.json.Model), Manufacturer: s(a.json.Manufacturer), PartNumber: s(a.json.PartNumber), SerialNumber: s(a.json.SerialNumber),
          firmware: s((a.json.Controllers || [])[0]?.FirmwarePackageVersion), ports,
        });
      }
    }
    const systemEth = [];
    const sid = ctx.sysIds[0];
    if (sid) {
      const { coll, items } = await readMembers(get, `${sid}/EthernetInterfaces`, 32);
      if (coll.kind === 'ok') {
        for (const it of items) if (it.kind === 'ok') systemEth.push({ Id: s(it.json.Id), MACAddress: s(it.json.MACAddress || it.json.PermanentMACAddress), SpeedMbps: num(it.json.SpeedMbps), LinkStatus: s(it.json.LinkStatus), IPv4: (it.json.IPv4Addresses || []).map((x) => s(x?.Address)).filter(Boolean).join(', ') });
      }
    }
    const ports = adapters.flatMap((a) => a.ports || []);
    const withSpeed = ports.filter((p) => p.speedMbps).length;
    const data = { adapters, systemEthernet: systemEth, ports: ports.length, portsWithSpeed: withSpeed };
    const note = `어댑터 ${adapters.filter((a) => !a.kind).length} · 포트 ${ports.length}(속도 ${withSpeed}) · 시스템 이더넷 ${systemEth.length}`;
    if (ports.length) return result(withSpeed ? 'ok' : 'partial', note, data, evidence);
    if (adapters.length || kinds.includes('ok')) return result(systemEth.length ? 'partial' : 'empty', `${note} — 포트 정보 없음`, data, evidence);
    if (systemEth.length) return result('partial', `NetworkAdapters ${bestOf(kinds)} · 시스템 이더넷 ${systemEth.length}개로 대체`, data, evidence);
    return result(ctx.chassisIds.length ? bestOf(kinds) : 'skip', '', data, evidence);
  },

  async pcie(ctx) {
    const { get, evidence } = ctx.scope();
    const sources = [];
    if (ctx.sysIds[0]) sources.push(`${ctx.sysIds[0]}/PCIeDevices`);
    for (const cid of ctx.chassisIds.slice(0, 2)) sources.push(`${cid}/PCIeDevices`);
    const devs = [];
    const kinds = [];
    const seen = new Set();
    for (const src of sources) {
      const { coll, items } = await readMembers(get, src, CAP.pcie);
      kinds.push(coll.kind);
      for (const it of items) {
        if (it.kind !== 'ok' || seen.has(it.path)) continue;
        seen.add(it.path);
        const d = it.json;
        devs.push({ source: src.includes('/Chassis/') ? 'Chassis' : 'Systems', Id: s(d.Id), Name: s(d.Name), Model: s(d.Model).trim(), Manufacturer: s(d.Manufacturer), DeviceType: s(d.DeviceType), FirmwareVersion: s(d.FirmwareVersion), PCIeType: s(d.PCIeInterface?.PCIeType), Lanes: num(d.PCIeInterface?.LanesInUse), Slot: s(d.Slot?.Location?.PartLocation?.ServiceLabel), Health: health(d) });
      }
    }
    if (devs.length) return result('ok', `PCIe 장치 ${devs.length}개`, { devices: devs }, evidence);
    if (kinds.includes('ok')) return result('empty', 'PCIeDevices 0개', { devices: devs }, evidence);
    return result(sources.length ? bestOf(kinds) : 'skip', '', { devices: devs }, evidence);
  },

  async logs(ctx) {
    const { get, evidence } = ctx.scope();
    const owners = [...ctx.mgrIds.slice(0, 1), ...ctx.sysIds.slice(0, 1), ...ctx.chassisIds.slice(0, 1)];
    const services = [];
    const kinds = [];
    for (const o of owners) {
      const r = await get(`${o}/LogServices`);
      kinds.push(r.kind);
      if (r.kind !== 'ok') continue;
      for (const sp of membersOf(r.json).slice(0, CAP.logServices)) {
        const sv = await get(sp);
        const rec = { owner: o.replace('/redfish/v1/', ''), path: sp, id: tail(sp), kind: sv.kind, note: sv.note, entries: null, recent: [], severities: {} };
        if (sv.kind === 'ok') {
          rec.Name = s(sv.json.Name); rec.MaxNumberOfRecords = num(sv.json.MaxNumberOfRecords); rec.OverWritePolicy = s(sv.json.OverWritePolicy);
          rec.ServiceEnabled = sv.json.ServiceEnabled ?? null; rec.LogEntryType = s(sv.json.LogEntryType);
          const el = linkOf(sv.json, 'Entries');
          if (el) {
            const en = await get(el);
            rec.entriesKind = en.kind;
            if (en.kind === 'ok') {
              const mem = Array.isArray(en.json.Members) ? en.json.Members : [];
              rec.entries = num(en.json['Members@odata.count']) ?? mem.length;
              rec.paged = !!en.json['Members@odata.nextLink'];
              let entries = mem.filter((m) => m && typeof m === 'object' && (m.Message || m.Severity || m.Created));
              if (!entries.length && mem.length) {
                const got = await mapLimit(membersOf(en.json).slice(-10), 2, (l) => get(l));
                entries = got.filter((g) => g.kind === 'ok').map((g) => g.json);
              }
              for (const e of entries) { const sev = s(e.Severity) || '—'; rec.severities[sev] = (rec.severities[sev] || 0) + 1; }
              const t = (e) => { const x = Date.parse(e.Created || ''); return Number.isFinite(x) ? x : 0; };
              rec.recent = entries.slice().sort((a, b) => t(b) - t(a)).slice(0, CAP.logEntries).map((e) => ({
                Created: s(e.Created), Severity: s(e.Severity), Message: s(e.Message).slice(0, 300), MessageId: s(e.MessageId), SensorType: s(e.SensorType), EntryType: s(e.EntryType), EntryCode: s(e.EntryCode),
              }));
            }
          }
        }
        services.push(rec);
      }
    }
    const mgr = ctx.mgrIds[0] || '';
    const dvcHit = DVC_LOG_SERVICES.filter((n) => services.some((x) => x.path === `${mgr}/LogServices/${n}`));
    const data = { services, dvcFixedPathsFound: dvcHit };
    const withEntries = services.filter((x) => (x.entries || 0) > 0);
    if (withEntries.length) return result('ok', services.map((x) => `${x.id}(${x.entries ?? '?'})`).join(' · '), data, evidence);
    if (services.length) return result('empty', `로그 서비스 ${services.length}개 · 항목 0`, data, evidence);
    return result(bestOf(kinds), '', data, evidence);
  },

  async firmware(ctx) {
    const { get, evidence } = ctx.scope();
    const coll = await get('/redfish/v1/UpdateService/FirmwareInventory');
    if (coll.kind !== 'ok') return result(coll.kind, coll.note, {}, evidence);
    const ids = membersOf(coll.json);
    const items = await mapLimit(ids.slice(0, CAP.fw), 2, (id) => get(id));
    const list = [];
    for (const it of items) {
      if (it.kind !== 'ok') continue;
      const f = it.json;
      list.push({ path: it.path, Id: s(f.Id), Name: s(f.Name), Version: s(f.Version), Updateable: f.Updateable ?? null, SoftwareId: s(f.SoftwareId), ReleaseDate: s(f.ReleaseDate), Health: health(f), dvcInstalled: FW_INSTALLED_RE.test(it.path), dvcType: classifyFw(f.Name || f.Id || '') });
    }
    const installed = ids.filter((id) => FW_INSTALLED_RE.test(id)).length;
    const data = { firmware: list, members: ids.length, dvcInstalledMatches: installed };
    if (!ids.length) return result('empty', 'FirmwareInventory 0개', data, evidence);
    return result('ok', `구성요소 ${ids.length}개 · The.DVC 필터(Installed-) 통과 ${installed}개`, data, evidence);
  },

  async licenses(ctx) {
    const { get, evidence } = ctx.scope();
    const mgr = ctx.mgrIds[0];
    const tried = [];
    const licenses = [];   // 라이선스 멤버(Licenses 컬렉션의 항목) — 실제 라이선스 기록
    const resources = [];  // 라이선스 관련 자원(Oem·후보 경로) — 내용 형식이 표준이 아니라 원문으로 확인해야 한다
    const read = async (p, how) => {
      const r = await get(p);
      tried.push({ path: p, how, kind: r.kind, status: r.status });
      if (r.kind !== 'ok') return r;
      const mem = membersOf(r.json);
      if (mem.length) {
        for (const m of mem.slice(0, CAP.lic)) {
          const l = await get(m);
          if (l.kind === 'ok') licenses.push({ from: how, Name: s(l.json.Name || l.json.LicenseDescription || l.json.Id), Type: s(l.json.LicenseType), Entitlement: s(l.json.EntitlementId), Expiry: s(l.json.ExpirationDate), keys: Object.keys(l.json).slice(0, 20) });
        }
      } else if (how !== '표준 LicenseService') {
        resources.push({ from: how, path: p, Name: s(r.json.Name || tail(p)), keys: Object.keys(r.json).filter((k) => !k.startsWith('@')).slice(0, 20), sample: JSON.stringify(r.json).slice(0, 400) });
      }
      return r;
    };
    const svc = await read('/redfish/v1/LicenseService', '표준 LicenseService');
    if (svc.kind === 'ok') { const l = linkOf(svc.json, 'Licenses'); if (l) await read(l, '표준 LicenseService'); }
    if (mgr) await read(DVC_LICENSE_PATHS(mgr)[1], 'Dell Oem(The.DVC 경로)');
    // Supermicro: 매니저 문서(Oem 포함)에 License 가 들어간 링크가 있으면 그것을 읽는다 + 알려진 후보 경로(추정).
    if (mgr) {
      const m = ctx.cache.get(mgr)?.json;
      const found = new Set();
      const walk = (o, d = 0) => {
        if (!o || typeof o !== 'object' || d > 6) return;
        for (const [k, v] of Object.entries(o)) {
          if (k === '@odata.id' && typeof v === 'string' && /licen/i.test(v)) found.add(v);
          else if (v && typeof v === 'object') walk(v, d + 1);
        }
      };
      walk(m);
      for (const p of found) await read(p, 'Oem 링크(매니저 문서)');
      for (const p of [`${mgr}/LicenseManager/QueryLicense`, `${mgr}/Oem/Supermicro/LicenseManager/QueryLicense`, `${mgr}/LicenseManager`]) {
        if (!tried.some((t) => t.path === p)) await read(p, 'Supermicro 후보 경로(추정)');
      }
    }
    const data = { licenses, resources, tried };
    const std = licenses.filter((l) => l.from === '표준 LicenseService' || l.from.startsWith('Dell'));
    if (std.length) return result('ok', `라이선스 ${std.length}건(The.DVC 경로)`, data, evidence);
    if (licenses.length || resources.length) return result('partial', `The.DVC 경로 없음 · Oem/후보 경로에서 라이선스 ${licenses.length}건 · 관련 자원 ${resources.length}개(내용은 원문 확인)`, data, evidence);
    return result(bestOf(tried.map((t) => t.kind)), '표준·Dell·Supermicro 후보 경로 모두 응답 없음', data, evidence);
  },

  async bios(ctx) {
    const { get, evidence } = ctx.scope();
    const sid = ctx.sysIds[0];
    if (!sid) return result('skip', 'System 없음', {}, evidence);
    const r = await get(`${sid}/Bios`);
    if (r.kind !== 'ok') return result(r.kind, r.note, {}, evidence);
    const attrs = r.json.Attributes && typeof r.json.Attributes === 'object' ? r.json.Attributes : {};
    const keys = Object.keys(attrs);
    const curated = BIOS_KEYS.filter((k) => attrs[k] !== undefined);
    const data = { AttributeRegistry: s(r.json.AttributeRegistry), count: keys.length, attributes: attrs, dvcCuratedHits: curated };
    if (!keys.length) return result('empty', '속성 0개', data, evidence);
    return result('ok', `속성 ${keys.length}개 · The.DVC 주요 키 일치 ${curated.length}/${BIOS_KEYS.length}`, data, evidence);
  },

  async secureBoot(ctx) {
    const { get, evidence } = ctx.scope();
    const sid = ctx.sysIds[0];
    if (!sid) return result('skip', 'System 없음', {}, evidence);
    const r = await get(`${sid}/SecureBoot`);
    if (r.kind !== 'ok') return result(r.kind, r.note, {}, evidence);
    const x = r.json;
    return result('ok', `${x.SecureBootEnable === true ? '켜짐' : x.SecureBootEnable === false ? '꺼짐' : '?'} · ${s(x.SecureBootMode) || '—'}`, { SecureBootEnable: x.SecureBootEnable ?? null, SecureBootCurrentBoot: s(x.SecureBootCurrentBoot), SecureBootMode: s(x.SecureBootMode) }, evidence);
  },

  async telemetry(ctx) {
    const { get, evidence } = ctx.scope();
    const svc = await get('/redfish/v1/TelemetryService');
    if (svc.kind !== 'ok') return result(svc.kind, svc.note, {}, evidence);
    const data = { ServiceEnabled: svc.json.ServiceEnabled ?? null, reports: [], definitions: null, metricDefinitions: null, usage: {} };
    const rl = linkOf(svc.json, 'MetricReports') || '/redfish/v1/TelemetryService/MetricReports';
    const reps = await get(rl);
    for (const [k, key] of [['MetricReportDefinitions', 'definitions'], ['MetricDefinitions', 'metricDefinitions']]) {
      const l = linkOf(svc.json, k);
      if (l) { const r = await get(l); if (r.kind === 'ok') data[key] = membersOf(r.json).length; }
    }
    if (reps.kind !== 'ok') return result('partial', `TelemetryService 는 있으나 MetricReports ${reps.note || reps.kind}`, data, evidence);
    const ids = membersOf(reps.json);
    data.reportIds = ids.map(tail);
    const rank = (id) => { const t = tail(id); const i = REPORT_KINDS.findIndex(([, re]) => re.test(t)); return i === -1 ? (/usage|cpu|mem|power|therm/i.test(t) ? 10 : 20) : i; };
    const pick = ids.slice().sort((a, b) => rank(a) - rank(b)).slice(0, CAP.reports);
    for (const id of pick) {
      const r = await get(id);
      if (r.kind !== 'ok') { data.reports.push({ id: tail(id), kind: r.kind }); continue; }
      const vals = Array.isArray(r.json.MetricValues) ? r.json.MetricValues : [];
      const mids = [...new Set(vals.map((v) => s(v.MetricId)).filter(Boolean))];
      data.reports.push({ id: tail(id), values: vals.length, metricIds: mids.slice(0, 25), Timestamp: s(r.json.Timestamp) });
      for (const [field, cands] of Object.entries(USAGE_IDS)) {
        if (data.usage[field]) continue;
        const hit = vals.find((v) => cands.some((c) => c.toLowerCase() === s(v.MetricId).toLowerCase()));
        if (hit) data.usage[field] = { report: tail(id), metricId: s(hit.MetricId), value: s(hit.MetricValue) };
      }
    }
    data.systemUsageReport = ids.some((id) => /^systemusage$/i.test(tail(id)));
    if (!ids.length) return result('empty', 'MetricReports 0개', data, evidence);
    if (Object.keys(data.usage).length) return result('ok', `리포트 ${ids.length}개 · ${Object.entries(data.usage).map(([k, v]) => `${k.replace('Pct', '')} ${v.value}`).join(' · ')}`, data, evidence);
    return result('partial', `리포트 ${ids.length}개 · The.DVC 사용률 메트릭 id 없음`, data, evidence);
  },

  async racadm() {
    return result('skip', 'PoC 는 SSH 를 쓰지 않음 — 코드 분석 항목(수정 지점 #7 참고)', {}, []);
  },

  async eventService(ctx) {
    const { get, evidence } = ctx.scope();
    const r = await get('/redfish/v1/EventService');
    if (r.kind !== 'ok') return result(r.kind, r.note, {}, evidence);
    const x = r.json;
    let subs = null;
    const sl = linkOf(x, 'Subscriptions');
    if (sl) { const sr = await get(sl); if (sr.kind === 'ok') subs = membersOf(sr.json).length; }
    return result('ok', `${x.ServiceEnabled === false ? '꺼짐' : '켜짐'} · 구독 ${subs ?? '—'}${x.ServerSentEventUri ? ' · SSE' : ''}`, { ServiceEnabled: x.ServiceEnabled ?? null, EventTypes: x.EventTypesForSubscription || [], subscriptions: subs, sse: !!x.ServerSentEventUri, DeliveryRetryAttempts: num(x.DeliveryRetryAttempts) }, evidence);
  },

  async virtualMedia(ctx) {
    const { get, evidence } = ctx.scope();
    const mgr = ctx.mgrIds[0];
    if (!mgr) return result('skip', 'Manager 없음', {}, evidence);
    let { coll, items } = await readMembers(get, `${mgr}/VirtualMedia`, CAP.vm);
    if (coll.kind !== 'ok' && ctx.sysIds[0]) ({ coll, items } = await readMembers(get, `${ctx.sysIds[0]}/VirtualMedia`, CAP.vm));
    if (coll.kind !== 'ok') return result(coll.kind, coll.note, {}, evidence);
    // Image URL 에는 계정이 섞일 수 있어 싣지 않는다(종류·삽입 여부만).
    const media = items.filter((i) => i.kind === 'ok').map((i) => ({ Id: s(i.json.Id), MediaTypes: i.json.MediaTypes || [], Inserted: i.json.Inserted ?? null, ConnectedVia: s(i.json.ConnectedVia) }));
    return result(media.length ? 'ok' : 'empty', `가상 미디어 ${media.length}개`, { media }, evidence);
  },
};

/** 실행 순서 — usageSensors 는 sensors 뒤, gpuMetrics 는 processors 뒤. oem 은 전체 탐색 뒤(runner 가 계산). */
const ORDER = CHECKS.map((c) => c.id).filter((id) => id !== 'oem');

/** 시스템·매니저·섀시 멤버를 먼저 알아 둔다(대부분의 점검이 그 경로를 쓴다). */
export async function discover(ctx) {
  for (const [coll, key] of [['/redfish/v1/Systems', 'sysIds'], ['/redfish/v1/Managers', 'mgrIds'], ['/redfish/v1/Chassis', 'chassisIds']]) {
    const r = await ctx.get(coll);
    ctx[key] = r.kind === 'ok' ? membersOf(r.json) : [];
  }
  if (ctx.sysIds[0]) await ctx.get(ctx.sysIds[0]);
  if (ctx.mgrIds[0]) await ctx.get(ctx.mgrIds[0]);
}

/**
 * 모든 점검 실행. 인증이 끊기면 남은 점검은 'auth' 로 채운다(요청을 보내지 않는다).
 * @returns {Promise<Record<string, object>>}
 */
export async function runChecks(ctx, { onCheck = null, sensorMemberCap = 300 } = {}) {
  const done = {};
  for (const id of ORDER) {
    if (ctx.signal?.aborted) { done[id] = result('skip', '취소됨'); continue; }
    if (ctx.client.authFailed && id !== 'racadm') { done[id] = result('auth', '인증 실패로 실행하지 않음'); continue; }
    onCheck?.(id, 'start');
    try {
      done[id] = await IMPL[id](ctx, { sensorMemberCap }, done);
    } catch (e) {
      done[id] = result('error', `점검 코드 오류: ${String(e?.message || e).slice(0, 200)}`);
    }
    onCheck?.(id, 'done', done[id]);
  }
  return done;
}

/** 전체 탐색 결과로 Oem 항목을 채운다. */
export function oemCheck(ctx, crawlIndex) {
  const keys = new Set();
  const add = (j) => { if (j?.Oem && typeof j.Oem === 'object') for (const k of Object.keys(j.Oem)) keys.add(k); };
  add(ctx.rootNoAuth?.json);
  for (const p of [ctx.sysIds[0], ctx.mgrIds[0], ctx.chassisIds[0]]) if (p) add(ctx.cache.get(p)?.json);
  const oemPaths = (crawlIndex || []).filter((x) => /\/Oem\//.test(x.path)).map((x) => ({ path: x.path, status: x.status }));
  const data = { oemKeys: [...keys], oemPaths: oemPaths.slice(0, 300), oemPathCount: oemPaths.length };
  if (!keys.size && !oemPaths.length) return result('empty', 'Oem 확장 없음', data, []);
  return result('ok', `Oem 키 ${[...keys].join(', ') || '—'} · Oem 경로 ${oemPaths.length}개`, data, []);
}
