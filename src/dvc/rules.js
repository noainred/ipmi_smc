/**
 * The.DVC 순수 판정식 사본 — 기준 커밋 d75a13c(noainred/The.DVC).
 *
 * 이 PoC 는 "Supermicro 응답을 The.DVC 가 받으면 무엇이 되는가" 를 재현해야 하므로, 원본의 판정을 **고치지 않고**
 * 옮긴다. 원본이 바뀌면 이 파일도 같은 커밋 기준으로 다시 옮길 것(파일:줄은 그 커밋 기준).
 */

// ── server/src/idrac/redfish.js:369-379 ─────────────────────────────────────────
export function isHpeSystem(sys, vendor = '') {
  if (String(vendor || '').trim().toLowerCase() === 'hpe') return true;
  const m = String(sys?.Manufacturer || '').trim();
  return /^(hpe|hp)\b/i.test(m) || /hewlett/i.test(m);
}
export function systemServiceTag(sys, vendor = '') {
  if (!sys || typeof sys !== 'object') return '';
  const sku = typeof sys.SKU === 'string' ? sys.SKU : '';
  const sn = typeof sys.SerialNumber === 'string' ? sys.SerialNumber : '';
  return isHpeSystem(sys, vendor) ? (sn || sku) : (sku || sn);
}

// ── server/src/idrac/redfish.js:327-331 ─────────────────────────────────────────
export function nicPortSpeedMbps(p = {}) {
  const toMb = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  const caps = Math.max(0, ...((p.SupportedLinkCapabilities || []).map((c) => toMb(c.LinkSpeedMbps))));
  return caps || (toMb(p.MaxSpeedGbps) * 1000) || (toMb(p.CurrentSpeedGbps) * 1000) || toMb(p.CurrentLinkSpeedMbps) || null;
}

// ── server/src/idrac/redfish.js:436-441 ─────────────────────────────────────────
export const BIOS_KEYS = [
  'BootMode', 'SysProfile', 'SystemProfile', 'ProcVirtualization', 'LogicalProc',
  'ProcCores', 'SriovGlobalEnable', 'MemFrequency', 'MemOpMode', 'NodeInterleave',
  'IntegratedRaid', 'SecureBoot', 'TpmSecurity', 'ProcTurboMode', 'EmbSata',
  'InternalUsb', 'PowerManagement', 'SerialComm', 'OsWatchdogTimer',
];

// ── server/src/idrac/redfish.js:1004-1017 ───────────────────────────────────────
export function classifyFw(name) {
  const n = String(name).toLowerCase();
  if (n.includes('bios')) return 'BIOS';
  if (n.includes('idrac') || n.includes('lifecycle') || n.includes('ism')) return 'iDRAC';
  if (n.includes('hba') || n.includes('fibre') || /\bfc\b/.test(n) || n.includes('host bus')) return 'HBA';
  if (n.includes('nic') || n.includes('network') || n.includes('ethernet') || n.includes('mellanox') || n.includes('broadcom') || n.includes('intel(r) ethernet') || n.includes('qlogic') || n.includes('connectx')) return 'NIC';
  if (n.includes('raid') || n.includes('perc') || n.includes('storage') || n.includes('bp') || n.includes('backplane')) return 'Storage';
  if (n.includes('power') || n.includes('psu') || n.includes('supply')) return 'PSU';
  if (n.includes('cpld') || n.includes('complex')) return 'CPLD';
  if (n.includes('disk') || n.includes('ssd') || n.includes('drive') || n.includes('nvme')) return 'Disk';
  if (n.includes('gpu') || n.includes('nvidia')) return 'GPU';
  if (n.includes('driver') || n.includes('os ')) return 'Driver';
  return '기타';
}

// ── server/src/idrac/redfish.js:982 — 설치된 펌웨어만 고르는 필터 ───────────────
export const FW_INSTALLED_RE = /\/Installed-/i;

// ── server/src/idrac/redfish.js:793 — 이벤트 로그 고정 경로 ─────────────────────
export const DVC_LOG_SERVICES = ['Sel', 'Lclog'];

// ── server/src/idrac/redfish.js:930 — 라이선스 경로 ─────────────────────────────
export const DVC_LICENSE_PATHS = (mgrId) => ['/redfish/v1/LicenseService/Licenses', `${mgrId || '/redfish/v1/Managers/iDRAC.Embedded.1'}/Oem/Dell/DellLicenses`];

// ── server/src/idrac/redfish.js:815 — GPU 판정 ──────────────────────────────────
export function isGpuProcessor(p) {
  return /gpu|accelerator/i.test(p?.ProcessorType || '') || /gpu|nvidia|tesla|a100|h100|h200|l40|l4\b/i.test(`${p?.Model || ''} ${p?.Name || ''}`);
}

// ── server/src/idrac/redfish.js:1385-1390 · 1519-1542 — 사용률 메트릭·센서 이름 ──
export const USAGE_IDS = Object.freeze({
  cpuPct: ['SystemBoardCPUUsage', 'CPUUsage', 'SystemBoardCPUUsagePercent'],
  memPct: ['SystemBoardMEMUsage', 'MemoryUsage', 'SystemBoardMemoryUsage'],
  ioPct: ['SystemBoardIOUsage', 'IOUsage', 'SystemBoardIOUsagePercent'],
  sysPct: ['SystemBoardSYSUsage', 'SYSUsage', 'SystemUsage'],
});
const SENSOR_PATTERNS = Object.freeze([
  ['cpuPct', /cpu.*usage|usage.*cpu/i],
  ['memPct', /(?:mem|memory).*usage|usage.*(?:mem|memory)/i],
  ['ioPct', /(?:^|[^a-z]|board)io.*usage|usage.*io(?:[^a-z]|$)/i],
  ['sysPct', /sys(?:tem)?.*usage|usage.*sys(?:tem)?/i],
]);
export function sensorFieldOf(name) {
  const low = String(name || '').toLowerCase();
  if (!low) return null;
  for (const field of ['cpuPct', 'memPct', 'ioPct', 'sysPct']) {
    for (const id of USAGE_IDS[field]) {
      const t = id.toLowerCase();
      if (low === t || low.endsWith(`_${t}`) || low.endsWith(`.${t}`) || low.endsWith(`/${t}`)) return field;
    }
  }
  for (const [field, re] of SENSOR_PATTERNS) if (re.test(low)) return field;
  return null;
}

// ── server/src/idrac/roomTemp.js:91-101 — 전산실 온도 분류 ──────────────────────
const PSU_SENSOR_RE = /\bp\/?s\s*\d|\bp\/s\b|\bpsu\d*\b|power\s*supply/i;
export function classifyRoomSensor(name) {
  const s = String(name || '');
  if (PSU_SENSOR_RE.test(s)) return 'other';
  if (/inlet|intake|ambient|front/i.test(s)) return 'inlet';
  if (/exhaust|outlet|exit|rear/i.test(s)) return 'exhaust';
  if (/cpu\s*\d*/i.test(s) || /proc|package|\bdie\b|\bcore\b/i.test(s)) return 'cpu';
  return 'other';
}

// ── server/src/bmusage/parse/idracTelemetry.js:59-65 — 리포트 이름 패턴 ─────────
export const REPORT_KINDS = Object.freeze([
  ['system', /^systemusage$|systemboardusage/i],
  ['nic', /nicstat|nicsensor|networkstat|nicmetric/i],
  ['fc', /fcport|fcsensor|fcstat|fibrechannel/i],
  ['storage', /storagedisk|storagesensor|nvmesmart|smartdata/i],
  ['cpumem', /cpumemmetric|aggregationmetric|cpusensor|memorysensor/i],
]);
