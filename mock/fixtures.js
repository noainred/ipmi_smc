/**
 * 목(mock) BMC 응답 — **합성 데이터다. 실장비 응답이 아니다.**
 *
 * DMTF Redfish 스키마 모양과 공개 자료(Supermicro Redfish 가이드의 경로 이름 등)를 바탕으로 만든 **가설**이며,
 * 목적은 (1) 이 PoC 의 코드 경로(인증·판정·탐색·화면)를 장비 없이 시험하고 (2) 화면 데모를 하는 것뿐이다.
 * Supermicro 의 실제 동작(라이선스 문구·로그 경로·SKU 값 등)에 대한 근거로 쓰지 말 것 — 근거는 실장비 실행 결과다.
 *
 * 각 픽스처는 { [경로]: 본문 | { $status, $body } } 맵을 돌려준다.
 */

const id = (p) => ({ '@odata.id': p });
const col = (p, members, extra = {}) => ({ '@odata.id': p, Name: `${p.split('/').pop()} Collection`, 'Members@odata.count': members.length, Members: members.map(id), ...extra });
const err = (status, msgId, message) => ({ $status: status, $body: { error: { code: 'Base.1.8.GeneralError', message, '@Message.ExtendedInfo': [{ MessageId: msgId, Message: message }] } } });
const ok = { Health: 'OK', State: 'Enabled' };

// ─────────────────────────────────────────────────────────────────────────────
export function supermicroFixture() {
  const R = '/redfish/v1';
  const S = `${R}/Systems/1`;
  const C = `${R}/Chassis/1`;
  const M = `${R}/Managers/1`;
  // ⚠ 가설: 라이선스가 없는 Supermicro BMC 가 일부 자원에 이런 문구로 거부한다고 가정한 것(실장비 미확인).
  const lic = err(403, 'SMC.1.0.OemLicenseNotPassed', 'Not licensed to perform this request. The following licenses SFT-DCMS-SINGLE were needed (합성 문구)');
  const f = {
    [R]: {
      '@odata.id': R, '@odata.type': '#ServiceRoot.v1_11_0.ServiceRoot', Id: 'RootService', Name: 'Root Service', RedfishVersion: '1.11.0',
      UUID: '00000000-0000-0000-0000-3cecef000001', Vendor: 'Supermicro', Product: '(합성 픽스처 — 실장비 아님)',
      Systems: id(`${R}/Systems`), Chassis: id(`${R}/Chassis`), Managers: id(`${R}/Managers`), SessionService: id(`${R}/SessionService`),
      AccountService: id(`${R}/AccountService`), EventService: id(`${R}/EventService`), UpdateService: id(`${R}/UpdateService`),
      Registries: id(`${R}/Registries`), JsonSchemas: id(`${R}/JsonSchemas`), Links: { Sessions: id(`${R}/SessionService/Sessions`) },
      Oem: { Supermicro: { DumpService: id(`${R}/Oem/Supermicro/DumpService`) } },
    },
    [`${R}/Oem/Supermicro/DumpService`]: { '@odata.id': `${R}/Oem/Supermicro/DumpService`, Name: 'Dump Service (합성)' },
    [`${R}/Registries`]: col(`${R}/Registries`, [`${R}/Registries/Base.1.8.0`]),
    [`${R}/Registries/Base.1.8.0`]: { '@odata.id': `${R}/Registries/Base.1.8.0`, Name: 'Base registry (탐색에서 건너뛰어야 함)' },
    [`${R}/JsonSchemas`]: col(`${R}/JsonSchemas`, [`${R}/JsonSchemas/Chassis`]),
    [`${R}/Systems`]: col(`${R}/Systems`, [S]),
    [S]: {
      '@odata.id': S, '@odata.type': '#ComputerSystem.v1_16_0.ComputerSystem', Id: '1', Name: 'System', SystemType: 'Physical',
      Manufacturer: 'Supermicro', Model: 'SYS-FIXTURE-X13', SKU: 'To be filled by O.E.M.', SerialNumber: 'FIX-SMC-0001', PartNumber: '',
      UUID: '00000000-0000-0000-0000-3cecef0000a1', BiosVersion: '2.1', PowerState: 'On', HostName: 'smc-fixture-01', Status: { ...ok, HealthRollup: 'Critical' },
      ProcessorSummary: { Count: 2, Model: 'Intel(R) Xeon(R) Fixture CPU', LogicalProcessorCount: 64, Status: ok },
      MemorySummary: { TotalSystemMemoryGiB: 96, Status: ok },
      Boot: { BootSourceOverrideEnabled: 'Disabled', BootSourceOverrideTarget: 'None', BootSourceOverrideMode: 'UEFI' },
      Processors: id(`${S}/Processors`), Memory: id(`${S}/Memory`), Storage: id(`${S}/Storage`), EthernetInterfaces: id(`${S}/EthernetInterfaces`),
      Bios: id(`${S}/Bios`), SecureBoot: id(`${S}/SecureBoot`), PCIeDevices: id(`${S}/PCIeDevices`), LogServices: id(`${S}/LogServices`),
      Oem: { Supermicro: { NodeManager: id(`${S}/Oem/Supermicro/NodeManager`) } },
    },
    [`${S}/Oem/Supermicro/NodeManager`]: { '@odata.id': `${S}/Oem/Supermicro/NodeManager`, Name: 'Node Manager (합성)', MaxPower: 600 },
    [`${S}/Bios`]: lic,
    [`${S}/SecureBoot`]: { '@odata.id': `${S}/SecureBoot`, SecureBootEnable: false, SecureBootCurrentBoot: 'Disabled', SecureBootMode: 'UserMode' },
    [`${S}/Storage`]: col(`${S}/Storage`, [`${S}/Storage/HA-RAID`]),
    [`${S}/Storage/HA-RAID`]: lic,
    [`${S}/SimpleStorage`]: { $status: 404, $body: { error: { message: 'not found' } } },
    [`${S}/Memory`]: col(`${S}/Memory`, ['P1-DIMMA1', 'P1-DIMMB1', 'P2-DIMMA1', 'P2-DIMMB1'].map((d) => `${S}/Memory/${d}`)),
    [`${S}/Processors`]: col(`${S}/Processors`, [`${S}/Processors/1`, `${S}/Processors/2`, `${S}/Processors/GPU1`]),
    [`${S}/Processors/1`]: { '@odata.id': `${S}/Processors/1`, Id: '1', Socket: 'CPU1', ProcessorType: 'CPU', Manufacturer: 'Intel(R) Corporation', Model: 'Intel(R) Xeon(R) Fixture CPU', TotalCores: 16, TotalThreads: 32, MaxSpeedMHz: 4000, Status: ok },
    [`${S}/Processors/2`]: { '@odata.id': `${S}/Processors/2`, Id: '2', Socket: 'CPU2', ProcessorType: 'CPU', Manufacturer: 'Intel(R) Corporation', Model: 'Intel(R) Xeon(R) Fixture CPU', TotalCores: 16, TotalThreads: 32, MaxSpeedMHz: 4000, Status: ok },
    [`${S}/Processors/GPU1`]: { '@odata.id': `${S}/Processors/GPU1`, Id: 'GPU1', Name: 'GPU1', ProcessorType: 'GPU', Manufacturer: 'NVIDIA', Model: 'NVIDIA Fixture GPU', Status: ok },
    [`${S}/EthernetInterfaces`]: col(`${S}/EthernetInterfaces`, [`${S}/EthernetInterfaces/1`, `${S}/EthernetInterfaces/2`]),
    [`${S}/EthernetInterfaces/1`]: { '@odata.id': `${S}/EthernetInterfaces/1`, Id: '1', MACAddress: '3c:ec:ef:00:00:01', SpeedMbps: 25000, LinkStatus: 'LinkUp' },
    [`${S}/EthernetInterfaces/2`]: { '@odata.id': `${S}/EthernetInterfaces/2`, Id: '2', MACAddress: '3c:ec:ef:00:00:02', SpeedMbps: 0, LinkStatus: 'LinkDown' },
    [`${S}/PCIeDevices`]: col(`${S}/PCIeDevices`, [`${S}/PCIeDevices/NIC1`, `${S}/PCIeDevices/GPU1`]),
    [`${S}/PCIeDevices/NIC1`]: { '@odata.id': `${S}/PCIeDevices/NIC1`, Id: 'NIC1', Name: 'AOC-FIXTURE-NIC', Manufacturer: 'Supermicro', DeviceType: 'SingleFunction', PCIeInterface: { PCIeType: 'Gen4', LanesInUse: 8 }, Status: ok },
    [`${S}/PCIeDevices/GPU1`]: { '@odata.id': `${S}/PCIeDevices/GPU1`, Id: 'GPU1', Name: 'NVIDIA Fixture GPU', Manufacturer: 'NVIDIA', DeviceType: 'SingleFunction', PCIeInterface: { PCIeType: 'Gen5', LanesInUse: 16 }, Status: ok },
    [`${S}/LogServices`]: col(`${S}/LogServices`, []),
    [`${R}/Chassis`]: col(`${R}/Chassis`, [C]),
    [C]: {
      '@odata.id': C, Id: '1', Name: 'Computer System Chassis', ChassisType: 'RackMount', Manufacturer: 'Supermicro', Model: 'CSE-FIXTURE', SerialNumber: 'FIX-CSE-0001', Status: ok,
      Power: id(`${C}/Power`), Thermal: id(`${C}/Thermal`), Sensors: id(`${C}/Sensors`), NetworkAdapters: id(`${C}/NetworkAdapters`),
      PowerSubsystem: id(`${C}/PowerSubsystem`), ThermalSubsystem: id(`${C}/ThermalSubsystem`), EnvironmentMetrics: id(`${C}/EnvironmentMetrics`),
    },
    [`${C}/Power`]: {
      '@odata.id': `${C}/Power`, PowerControl: [{ MemberId: '0', Name: 'System Power Control', PowerConsumedWatts: 388, PowerCapacityWatts: 1600, PowerMetrics: { AverageConsumedWatts: 380, MinConsumedWatts: 350, MaxConsumedWatts: 420, IntervalInMin: 1 } }],
      PowerSupplies: [
        { MemberId: '0', Name: 'PSU1', Model: 'PWS-FIXTURE', Manufacturer: 'Supermicro', SerialNumber: 'P1FIX', PowerCapacityWatts: 1600, LineInputVoltage: 220, LastPowerOutputWatts: 190, Status: ok },
        { MemberId: '1', Name: 'PSU2', Model: 'PWS-FIXTURE', Manufacturer: 'Supermicro', SerialNumber: 'P2FIX', PowerCapacityWatts: 1600, LineInputVoltage: 0, Status: { Health: 'Critical', State: 'Enabled' } },
      ],
      Voltages: [{ Name: '12V', ReadingVolts: 12.1 }, { Name: 'VBAT', ReadingVolts: 3.06 }],
    },
    [`${C}/Thermal`]: {
      '@odata.id': `${C}/Thermal`,
      Temperatures: [
        { MemberId: '0', Name: 'CPU1 Temp', ReadingCelsius: 48, UpperThresholdCritical: 95, Status: ok, PhysicalContext: 'CPU' },
        { MemberId: '1', Name: 'CPU2 Temp', ReadingCelsius: 51, UpperThresholdCritical: 95, Status: ok, PhysicalContext: 'CPU' },
        { MemberId: '2', Name: 'Inlet Temp', ReadingCelsius: 24, UpperThresholdCritical: 45, Status: ok, PhysicalContext: 'Intake' },
        { MemberId: '3', Name: 'System Temp', ReadingCelsius: 32, Status: ok, PhysicalContext: 'SystemBoard' },
        { MemberId: '4', Name: 'Peripheral Temp', ReadingCelsius: 38, Status: ok },
        { MemberId: '5', Name: 'P1-DIMMB1 Temp', ReadingCelsius: 0, Status: { State: 'Absent' } },
      ],
      Fans: [
        { MemberId: '0', Name: 'FAN1', Reading: 4200, ReadingUnits: 'RPM', LowerThresholdCritical: 700, Status: ok },
        { MemberId: '1', Name: 'FAN2', Reading: 4100, ReadingUnits: 'RPM', Status: ok },
        { MemberId: '4', Name: 'FAN5', Reading: null, ReadingUnits: 'RPM', Status: { State: 'Absent' } },
      ],
    },
    [`${C}/Sensors`]: col(`${C}/Sensors`, ['CPU1Temp', 'InletTemp', '12V', 'VBAT', 'PSU1InputPower'].map((x) => `${C}/Sensors/${x}`)),
    [`${C}/Sensors/CPU1Temp`]: { '@odata.id': `${C}/Sensors/CPU1Temp`, Id: 'CPU1Temp', Name: 'CPU1 Temp', Reading: 48, ReadingUnits: 'Cel', ReadingType: 'Temperature', PhysicalContext: 'CPU', Status: ok },
    [`${C}/Sensors/InletTemp`]: { '@odata.id': `${C}/Sensors/InletTemp`, Id: 'InletTemp', Name: 'Inlet Temp', Reading: 24, ReadingUnits: 'Cel', ReadingType: 'Temperature', Status: ok },
    [`${C}/Sensors/12V`]: { '@odata.id': `${C}/Sensors/12V`, Id: '12V', Name: '12V', Reading: 12.1, ReadingUnits: 'V', ReadingType: 'Voltage', Status: ok },
    [`${C}/Sensors/VBAT`]: { '@odata.id': `${C}/Sensors/VBAT`, Id: 'VBAT', Name: 'VBAT', Reading: 3.06, ReadingUnits: 'V', ReadingType: 'Voltage', Status: ok },
    [`${C}/Sensors/PSU1InputPower`]: { '@odata.id': `${C}/Sensors/PSU1InputPower`, Id: 'PSU1InputPower', Name: 'PSU1 Input Power', Reading: 200, ReadingUnits: 'W', ReadingType: 'Power', Status: ok },
    [`${C}/NetworkAdapters`]: col(`${C}/NetworkAdapters`, [`${C}/NetworkAdapters/1`]),
    [`${C}/NetworkAdapters/1`]: { '@odata.id': `${C}/NetworkAdapters/1`, Id: '1', Model: 'AOC-FIXTURE-NIC', Manufacturer: 'Supermicro', Controllers: [{ FirmwarePackageVersion: '1.0', Links: { NetworkPorts: [id(`${C}/NetworkAdapters/1/NetworkPorts/1`)] } }] },
    [`${C}/NetworkAdapters/1/NetworkPorts/1`]: { '@odata.id': `${C}/NetworkAdapters/1/NetworkPorts/1`, Id: '1', LinkStatus: 'Up', AssociatedNetworkAddresses: ['3c:ec:ef:00:00:01'] },
    [`${C}/PowerSubsystem`]: { '@odata.id': `${C}/PowerSubsystem`, CapacityWatts: 1600, PowerSupplies: id(`${C}/PowerSubsystem/PowerSupplies`) },
    [`${C}/PowerSubsystem/PowerSupplies`]: col(`${C}/PowerSubsystem/PowerSupplies`, [`${C}/PowerSubsystem/PowerSupplies/1`, `${C}/PowerSubsystem/PowerSupplies/2`]),
    [`${C}/PowerSubsystem/PowerSupplies/1`]: { '@odata.id': `${C}/PowerSubsystem/PowerSupplies/1`, Name: 'PSU1', Model: 'PWS-FIXTURE', SerialNumber: 'P1FIX', Status: ok },
    [`${C}/PowerSubsystem/PowerSupplies/2`]: { '@odata.id': `${C}/PowerSubsystem/PowerSupplies/2`, Name: 'PSU2', Model: 'PWS-FIXTURE', SerialNumber: 'P2FIX', Status: { Health: 'Critical', State: 'Enabled' } },
    [`${C}/EnvironmentMetrics`]: { '@odata.id': `${C}/EnvironmentMetrics`, PowerWatts: { Reading: 388 }, TemperatureCelsius: { Reading: 24 } },
    [`${C}/ThermalSubsystem`]: { '@odata.id': `${C}/ThermalSubsystem`, Fans: id(`${C}/ThermalSubsystem/Fans`), ThermalMetrics: id(`${C}/ThermalSubsystem/ThermalMetrics`) },
    [`${C}/ThermalSubsystem/Fans`]: col(`${C}/ThermalSubsystem/Fans`, [`${C}/ThermalSubsystem/Fans/FAN1`]),
    [`${C}/ThermalSubsystem/Fans/FAN1`]: { '@odata.id': `${C}/ThermalSubsystem/Fans/FAN1`, Name: 'FAN1', SpeedPercent: { Reading: 40, SpeedRPM: 4200 }, Status: ok },
    [`${C}/ThermalSubsystem/ThermalMetrics`]: { '@odata.id': `${C}/ThermalSubsystem/ThermalMetrics`, TemperatureReadingsCelsius: [{ DeviceName: 'CPU1 Temp', Reading: 48 }, { DeviceName: 'Inlet Temp', Reading: 24 }] },
    [`${R}/Managers`]: col(`${R}/Managers`, [M]),
    [M]: {
      '@odata.id': M, Id: '1', Name: 'Manager', ManagerType: 'BMC', Model: 'ASPEED (합성)', FirmwareVersion: '01.01.10', UUID: '00000000-0000-0000-0000-3cecef0000b1',
      DateTime: '2026-10-27T09:40:00+09:00', DateTimeLocalOffset: '+09:00', Status: ok,
      EthernetInterfaces: id(`${M}/EthernetInterfaces`), NetworkProtocol: id(`${M}/NetworkProtocol`), LogServices: id(`${M}/LogServices`), VirtualMedia: id(`${M}/VirtualMedia`),
      // ⚠ 가설: Supermicro Oem 아래 라이선스 관리 자원이 있다고 가정(경로는 실장비로 확인할 것)
      Oem: { Supermicro: { LicenseManager: id(`${M}/LicenseManager`), FanMode: id(`${M}/Oem/Supermicro/FanMode`) } },
    },
    [`${M}/Oem/Supermicro/FanMode`]: { '@odata.id': `${M}/Oem/Supermicro/FanMode`, Mode: 'Standard' },
    [`${M}/LicenseManager`]: { '@odata.id': `${M}/LicenseManager`, Name: 'License Manager (합성)', QueryLicense: id(`${M}/LicenseManager/QueryLicense`) },
    [`${M}/LicenseManager/QueryLicense`]: { '@odata.id': `${M}/LicenseManager/QueryLicense`, Licenses: [], Name: 'Query License (합성 — 라이선스 없음)' },
    [`${M}/EthernetInterfaces`]: col(`${M}/EthernetInterfaces`, [`${M}/EthernetInterfaces/1`]),
    [`${M}/EthernetInterfaces/1`]: { '@odata.id': `${M}/EthernetInterfaces/1`, Id: '1', MACAddress: '3c:ec:ef:00:00:ff', HostName: 'smc-fixture-bmc', IPv4Addresses: [{ Address: '127.0.0.1' }], SpeedMbps: 1000 },
    [`${M}/NetworkProtocol`]: { '@odata.id': `${M}/NetworkProtocol`, HostName: 'smc-fixture-bmc', HTTPS: { ProtocolEnabled: true, Port: 443 }, HTTP: { ProtocolEnabled: true, Port: 80 }, SSH: { ProtocolEnabled: true, Port: 22 }, IPMI: { ProtocolEnabled: true, Port: 623 }, SNMP: { ProtocolEnabled: false, Port: 161 } },
    [`${M}/LogServices`]: col(`${M}/LogServices`, [`${M}/LogServices/Log1`]),
    [`${M}/LogServices/Log1`]: { '@odata.id': `${M}/LogServices/Log1`, Id: 'Log1', Name: 'Log Service', MaxNumberOfRecords: 512, OverWritePolicy: 'WrapsWhenFull', ServiceEnabled: true, Entries: id(`${M}/LogServices/Log1/Entries`) },
    [`${M}/LogServices/Log1/Entries`]: {
      '@odata.id': `${M}/LogServices/Log1/Entries`, 'Members@odata.count': 3,
      Members: [
        { '@odata.id': `${M}/LogServices/Log1/Entries/1`, Id: '1', Created: '2026-10-26T22:14:07+09:00', Severity: 'Critical', Message: 'Power Supply PS2 Status: AC lost - Asserted (합성)', EntryType: 'SEL', SensorType: 'Power Supply' },
        { '@odata.id': `${M}/LogServices/Log1/Entries/2`, Id: '2', Created: '2026-10-25T03:02:19+09:00', Severity: 'Warning', Message: 'Memory P1-DIMMA1 Correctable ECC - Asserted (합성)', EntryType: 'SEL', SensorType: 'Memory' },
        { '@odata.id': `${M}/LogServices/Log1/Entries/3`, Id: '3', Created: '2026-10-20T11:40:02+09:00', Severity: 'OK', Message: 'OS Boot completed (합성)', EntryType: 'SEL' },
      ],
    },
    [`${M}/VirtualMedia`]: col(`${M}/VirtualMedia`, [`${M}/VirtualMedia/CD1`]),
    [`${M}/VirtualMedia/CD1`]: { '@odata.id': `${M}/VirtualMedia/CD1`, Id: 'CD1', MediaTypes: ['CD', 'DVD'], Inserted: false, Image: 'http://user:secret@example.invalid/iso' },
    [`${R}/AccountService`]: { '@odata.id': `${R}/AccountService`, ServiceEnabled: true, AccountLockoutThreshold: 5, AccountLockoutDuration: 300, MinPasswordLength: 8, Accounts: id(`${R}/AccountService/Accounts`) },
    [`${R}/AccountService/Accounts`]: col(`${R}/AccountService/Accounts`, [`${R}/AccountService/Accounts/2`, `${R}/AccountService/Accounts/3`]),
    [`${R}/AccountService/Accounts/2`]: { '@odata.id': `${R}/AccountService/Accounts/2`, Id: '2', UserName: 'ADMIN', RoleId: 'Administrator', Enabled: true, Locked: false, Password: null },
    [`${R}/AccountService/Accounts/3`]: { '@odata.id': `${R}/AccountService/Accounts/3`, Id: '3', UserName: 'monitor', RoleId: 'ReadOnly', Enabled: true, Locked: false, Password: null },
    [`${R}/SessionService`]: { '@odata.id': `${R}/SessionService`, ServiceEnabled: true, SessionTimeout: 1800, Sessions: id(`${R}/SessionService/Sessions`) },
    [`${R}/EventService`]: { '@odata.id': `${R}/EventService`, ServiceEnabled: true, EventTypesForSubscription: ['Alert'], Subscriptions: id(`${R}/EventService/Subscriptions`) },
    [`${R}/EventService/Subscriptions`]: col(`${R}/EventService/Subscriptions`, []),
    [`${R}/UpdateService`]: { '@odata.id': `${R}/UpdateService`, ServiceEnabled: true, FirmwareInventory: id(`${R}/UpdateService/FirmwareInventory`) },
    [`${R}/UpdateService/FirmwareInventory`]: col(`${R}/UpdateService/FirmwareInventory`, [`${R}/UpdateService/FirmwareInventory/BMC`, `${R}/UpdateService/FirmwareInventory/BIOS`]),
    [`${R}/UpdateService/FirmwareInventory/BMC`]: { '@odata.id': `${R}/UpdateService/FirmwareInventory/BMC`, Id: 'BMC', Name: 'BMC Firmware', Version: '01.01.10', Updateable: true, Status: ok },
    [`${R}/UpdateService/FirmwareInventory/BIOS`]: { '@odata.id': `${R}/UpdateService/FirmwareInventory/BIOS`, Id: 'BIOS', Name: 'BIOS', Version: '2.1', Updateable: true, Status: ok },
  };
  const dimm = (n, absent) => ({ '@odata.id': `${S}/Memory/${n}`, Id: n, Name: n, DeviceLocator: n, ...(absent ? { Status: { State: 'Absent' } } : { CapacityMiB: 32768, OperatingSpeedMhz: 4800, MemoryDeviceType: 'DDR5', Manufacturer: 'Fixture', PartNumber: 'FIX-32G', SerialNumber: `${n}-SN`, RankCount: 2, Status: ok }) });
  f[`${S}/Memory/P1-DIMMA1`] = dimm('P1-DIMMA1');
  f[`${S}/Memory/P1-DIMMB1`] = dimm('P1-DIMMB1', true);
  f[`${S}/Memory/P2-DIMMA1`] = dimm('P2-DIMMA1');
  f[`${S}/Memory/P2-DIMMB1`] = dimm('P2-DIMMB1');
  return f;
}

// ─────────────────────────────────────────────────────────────────────────────
export function dellFixture() {
  const R = '/redfish/v1';
  const S = `${R}/Systems/System.Embedded.1`;
  const C = `${R}/Chassis/System.Embedded.1`;
  const M = `${R}/Managers/iDRAC.Embedded.1`;
  const f = {
    [R]: {
      '@odata.id': R, '@odata.type': '#ServiceRoot.v1_15_0.ServiceRoot', Id: 'RootService', Name: 'Root Service', RedfishVersion: '1.17.0',
      Vendor: 'Dell', Product: 'Integrated Dell Remote Access Controller', UUID: '00000000-0000-0000-0000-d311000000a1',
      Systems: id(`${R}/Systems`), Chassis: id(`${R}/Chassis`), Managers: id(`${R}/Managers`), SessionService: id(`${R}/SessionService`),
      AccountService: id(`${R}/AccountService`), EventService: id(`${R}/EventService`), UpdateService: id(`${R}/UpdateService`),
      TelemetryService: id(`${R}/TelemetryService`), LicenseService: id(`${R}/LicenseService`), Links: { Sessions: id(`${R}/SessionService/Sessions`) },
      Oem: { Dell: { '@odata.type': '#DellServiceRoot.v1_0_0.DellServiceRoot', IsBranded: 0 } },
    },
    [`${R}/Systems`]: col(`${R}/Systems`, [S]),
    [S]: {
      '@odata.id': S, Id: 'System.Embedded.1', Manufacturer: 'Dell Inc.', Model: 'PowerEdge FIXTURE', SKU: 'FIXTAG1', SerialNumber: 'CNFIX00000000001',
      UUID: '4c4c4544-0000-0000-0000-000000000001', BiosVersion: '1.15.0', PowerState: 'On', HostName: 'dell-fixture-01', Status: ok,
      ProcessorSummary: { Count: 2, Model: 'Intel(R) Xeon(R) Fixture', LogicalProcessorCount: 64, Status: ok }, MemorySummary: { TotalSystemMemoryGiB: 128, Status: ok },
      Processors: id(`${S}/Processors`), Memory: id(`${S}/Memory`), Storage: id(`${S}/Storage`), EthernetInterfaces: id(`${S}/EthernetInterfaces`),
      Bios: id(`${S}/Bios`), SecureBoot: id(`${S}/SecureBoot`), PCIeDevices: id(`${S}/PCIeDevices`),
      Oem: { Dell: { DellSystem: id(`${S}/Oem/Dell/DellSystem/System.Embedded.1`) } },
    },
    [`${S}/Oem/Dell/DellSystem/System.Embedded.1`]: { '@odata.id': `${S}/Oem/Dell/DellSystem/System.Embedded.1`, Name: 'DellSystem (합성)' },
    [`${S}/Bios`]: { '@odata.id': `${S}/Bios`, AttributeRegistry: 'BiosAttributeRegistry.v1_0_3', Attributes: { BootMode: 'Uefi', SysProfile: 'PerfOptimized', ProcVirtualization: 'Enabled', LogicalProc: 'Enabled', SriovGlobalEnable: 'Enabled', MemOpMode: 'OptimizerMode', ProcTurboMode: 'Enabled', SerialComm: 'OnConRedirCom2' } },
    [`${S}/SecureBoot`]: { '@odata.id': `${S}/SecureBoot`, SecureBootEnable: true, SecureBootCurrentBoot: 'Enabled', SecureBootMode: 'DeployedMode' },
    [`${S}/Storage`]: col(`${S}/Storage`, [`${S}/Storage/RAID.Integrated.1-1`]),
    [`${S}/Storage/RAID.Integrated.1-1`]: {
      '@odata.id': `${S}/Storage/RAID.Integrated.1-1`, Id: 'RAID.Integrated.1-1', Name: 'PERC FIXTURE',
      StorageControllers: [{ Name: 'PERC H755 Fixture', Model: 'PERC H755 Fixture', Manufacturer: 'DELL', FirmwareVersion: '52.26.0', SpeedGbps: 12, SupportedDeviceProtocols: ['SAS', 'SATA'], Status: ok }],
      Drives: [id(`${S}/Storage/RAID.Integrated.1-1/Drives/Disk.Bay.0`), id(`${S}/Storage/RAID.Integrated.1-1/Drives/Disk.Bay.1`)],
      Volumes: id(`${S}/Storage/RAID.Integrated.1-1/Volumes`),
    },
    [`${S}/Storage/RAID.Integrated.1-1/Volumes`]: col(`${S}/Storage/RAID.Integrated.1-1/Volumes`, [`${S}/Storage/RAID.Integrated.1-1/Volumes/Disk.Virtual.0`]),
    [`${S}/Storage/RAID.Integrated.1-1/Volumes/Disk.Virtual.0`]: { '@odata.id': `${S}/Storage/RAID.Integrated.1-1/Volumes/Disk.Virtual.0`, Name: 'VD0', RAIDType: 'RAID1' },
    [`${S}/Storage/RAID.Integrated.1-1/Drives/Disk.Bay.0`]: { '@odata.id': `${S}/Storage/RAID.Integrated.1-1/Drives/Disk.Bay.0`, Id: 'Disk.Bay.0', Name: 'SSD 0', Model: 'FIXTURE-SSD', SerialNumber: 'SSD0', CapacityBytes: 960000000000, MediaType: 'SSD', Protocol: 'SAS', FailurePredicted: false, Status: ok },
    [`${S}/Storage/RAID.Integrated.1-1/Drives/Disk.Bay.1`]: { '@odata.id': `${S}/Storage/RAID.Integrated.1-1/Drives/Disk.Bay.1`, Id: 'Disk.Bay.1', Name: 'SSD 1', Model: 'FIXTURE-SSD', SerialNumber: 'SSD1', CapacityBytes: 960000000000, MediaType: 'SSD', Protocol: 'SAS', FailurePredicted: false, Status: ok },
    [`${S}/SimpleStorage`]: col(`${S}/SimpleStorage`, []),
    [`${S}/Memory`]: col(`${S}/Memory`, [`${S}/Memory/DIMM.Socket.A1`, `${S}/Memory/DIMM.Socket.B1`]),
    [`${S}/Memory/DIMM.Socket.A1`]: { '@odata.id': `${S}/Memory/DIMM.Socket.A1`, Id: 'DIMM.Socket.A1', DeviceLocator: 'DIMM.Socket.A1', CapacityMiB: 65536, OperatingSpeedMhz: 3200, MemoryDeviceType: 'DDR4', Manufacturer: 'Fixture', PartNumber: 'FIX-64G', SerialNumber: 'A1SN', RankCount: 2, Status: ok },
    [`${S}/Memory/DIMM.Socket.B1`]: { '@odata.id': `${S}/Memory/DIMM.Socket.B1`, Id: 'DIMM.Socket.B1', DeviceLocator: 'DIMM.Socket.B1', CapacityMiB: 65536, OperatingSpeedMhz: 3200, MemoryDeviceType: 'DDR4', Manufacturer: 'Fixture', PartNumber: 'FIX-64G', SerialNumber: 'B1SN', RankCount: 2, Status: ok },
    [`${S}/Processors`]: col(`${S}/Processors`, [`${S}/Processors/CPU.Socket.1`, `${S}/Processors/CPU.Socket.2`]),
    [`${S}/Processors/CPU.Socket.1`]: { '@odata.id': `${S}/Processors/CPU.Socket.1`, Id: 'CPU.Socket.1', Socket: 'CPU.Socket.1', ProcessorType: 'CPU', Model: 'Intel(R) Xeon(R) Fixture', Manufacturer: 'Intel', TotalCores: 16, TotalThreads: 32, MaxSpeedMHz: 4000, Status: ok },
    [`${S}/Processors/CPU.Socket.2`]: { '@odata.id': `${S}/Processors/CPU.Socket.2`, Id: 'CPU.Socket.2', Socket: 'CPU.Socket.2', ProcessorType: 'CPU', Model: 'Intel(R) Xeon(R) Fixture', Manufacturer: 'Intel', TotalCores: 16, TotalThreads: 32, MaxSpeedMHz: 4000, Status: ok },
    [`${S}/EthernetInterfaces`]: col(`${S}/EthernetInterfaces`, [`${S}/EthernetInterfaces/NIC.Integrated.1-1-1`]),
    [`${S}/EthernetInterfaces/NIC.Integrated.1-1-1`]: { '@odata.id': `${S}/EthernetInterfaces/NIC.Integrated.1-1-1`, Id: 'NIC.Integrated.1-1-1', MACAddress: 'b0:26:28:00:00:01', SpeedMbps: 25000, LinkStatus: 'LinkUp' },
    [`${S}/PCIeDevices`]: col(`${S}/PCIeDevices`, [`${S}/PCIeDevices/59-0`]),
    [`${S}/PCIeDevices/59-0`]: { '@odata.id': `${S}/PCIeDevices/59-0`, Id: '59-0', Name: 'Broadcom Fixture NIC', Manufacturer: 'Broadcom', DeviceType: 'MultiFunction', Status: ok },
    [`${R}/Chassis`]: col(`${R}/Chassis`, [C]),
    [C]: { '@odata.id': C, Id: 'System.Embedded.1', Name: 'Computer System Chassis', Model: 'PowerEdge FIXTURE', Power: id(`${C}/Power`), Thermal: id(`${C}/Thermal`), Sensors: id(`${C}/Sensors`), NetworkAdapters: id(`${C}/NetworkAdapters`), Status: ok },
    [`${C}/Power`]: {
      '@odata.id': `${C}/Power`, PowerControl: [{ MemberId: 'PowerControl', Name: 'System Power Control', PowerConsumedWatts: 412, PowerCapacityWatts: 1400, PowerLimit: { LimitInWatts: null } }],
      PowerSupplies: [
        { MemberId: 'PSU.Slot.1', Name: 'PS1 Status', Model: 'PWR SPLY,1400W,RDNT,FIXTURE', Manufacturer: 'DELL', SerialNumber: 'PS1SN', PowerCapacityWatts: 1400, LineInputVoltage: 230, Status: ok },
        { MemberId: 'PSU.Slot.2', Name: 'PS2 Status', Model: 'PWR SPLY,1400W,RDNT,FIXTURE', Manufacturer: 'DELL', SerialNumber: 'PS2SN', PowerCapacityWatts: 1400, LineInputVoltage: 230, Status: ok },
      ],
    },
    [`${C}/Thermal`]: {
      '@odata.id': `${C}/Thermal`,
      Temperatures: [
        { MemberId: 'iDRAC.Embedded.1#SystemBoardInletTemp', Name: 'System Board Inlet Temp', ReadingCelsius: 22, UpperThresholdCritical: 47, Status: ok },
        { MemberId: 'iDRAC.Embedded.1#SystemBoardExhaustTemp', Name: 'System Board Exhaust Temp', ReadingCelsius: 35, Status: ok },
        { MemberId: 'iDRAC.Embedded.1#CPU1Temp', Name: 'CPU1 Temp', ReadingCelsius: 52, Status: ok },
        { MemberId: 'iDRAC.Embedded.1#CPU2Temp', Name: 'CPU2 Temp', ReadingCelsius: 50, Status: ok },
      ],
      Fans: [{ MemberId: 'Fan1A', Name: 'System Board Fan1A', Reading: 6840, ReadingUnits: 'RPM', Status: ok }, { MemberId: 'Fan2A', Name: 'System Board Fan2A', Reading: 6720, ReadingUnits: 'RPM', Status: ok }],
    },
    [`${C}/Sensors`]: col(`${C}/Sensors`, [`${C}/Sensors/SystemBoardCPUUsage`, `${C}/Sensors/SystemBoardInletTemp`]),
    [`${C}/Sensors/SystemBoardCPUUsage`]: { '@odata.id': `${C}/Sensors/SystemBoardCPUUsage`, Id: 'SystemBoardCPUUsage', Name: 'System Board CPU Usage', Reading: 23, ReadingUnits: '%', ReadingType: 'Percent', Status: ok },
    [`${C}/Sensors/SystemBoardInletTemp`]: { '@odata.id': `${C}/Sensors/SystemBoardInletTemp`, Id: 'SystemBoardInletTemp', Name: 'System Board Inlet Temp', Reading: 22, ReadingUnits: 'Cel', ReadingType: 'Temperature', Status: ok },
    [`${C}/NetworkAdapters`]: col(`${C}/NetworkAdapters`, [`${C}/NetworkAdapters/NIC.Integrated.1`]),
    [`${C}/NetworkAdapters/NIC.Integrated.1`]: { '@odata.id': `${C}/NetworkAdapters/NIC.Integrated.1`, Id: 'NIC.Integrated.1', Model: 'Broadcom Fixture', Manufacturer: 'Broadcom', PartNumber: 'FIXPN', SerialNumber: 'FIXSN', NetworkPorts: id(`${C}/NetworkAdapters/NIC.Integrated.1/NetworkPorts`), Controllers: [{ FirmwarePackageVersion: '22.31.6' }] },
    [`${C}/NetworkAdapters/NIC.Integrated.1/NetworkPorts`]: col(`${C}/NetworkAdapters/NIC.Integrated.1/NetworkPorts`, [`${C}/NetworkAdapters/NIC.Integrated.1/NetworkPorts/NIC.Integrated.1-1`]),
    [`${C}/NetworkAdapters/NIC.Integrated.1/NetworkPorts/NIC.Integrated.1-1`]: { '@odata.id': `${C}/NetworkAdapters/NIC.Integrated.1/NetworkPorts/NIC.Integrated.1-1`, Id: 'NIC.Integrated.1-1', LinkStatus: 'Up', SupportedLinkCapabilities: [{ LinkSpeedMbps: 25000 }], AssociatedNetworkAddresses: ['b0:26:28:00:00:01'] },
    [`${R}/Managers`]: col(`${R}/Managers`, [M]),
    [M]: { '@odata.id': M, Id: 'iDRAC.Embedded.1', ManagerType: 'BMC', Model: '17G Monolithic (합성)', FirmwareVersion: '7.00.00.00', Status: ok, EthernetInterfaces: id(`${M}/EthernetInterfaces`), NetworkProtocol: id(`${M}/NetworkProtocol`), LogServices: id(`${M}/LogServices`), VirtualMedia: id(`${M}/VirtualMedia`) },
    [`${M}/EthernetInterfaces`]: col(`${M}/EthernetInterfaces`, [`${M}/EthernetInterfaces/NIC.1`]),
    [`${M}/EthernetInterfaces/NIC.1`]: { '@odata.id': `${M}/EthernetInterfaces/NIC.1`, Id: 'NIC.1', MACAddress: 'b0:26:28:00:00:ff', HostName: 'idrac-fixture', IPv4Addresses: [{ Address: '127.0.0.1' }], SpeedMbps: 1000 },
    [`${M}/NetworkProtocol`]: { '@odata.id': `${M}/NetworkProtocol`, HTTPS: { ProtocolEnabled: true, Port: 443 }, SSH: { ProtocolEnabled: true, Port: 22 }, IPMI: { ProtocolEnabled: false, Port: 623 }, SNMP: { ProtocolEnabled: true, Port: 161 } },
    [`${M}/LogServices`]: col(`${M}/LogServices`, [`${M}/LogServices/Sel`, `${M}/LogServices/Lclog`]),
    [`${M}/LogServices/Sel`]: { '@odata.id': `${M}/LogServices/Sel`, Id: 'Sel', Name: 'SEL Log Service', Entries: id(`${M}/LogServices/Sel/Entries`) },
    [`${M}/LogServices/Sel/Entries`]: { '@odata.id': `${M}/LogServices/Sel/Entries`, 'Members@odata.count': 1, Members: [{ '@odata.id': `${M}/LogServices/Sel/Entries/1`, Id: '1', Created: '2026-10-26T10:00:00-05:00', Severity: 'Warning', Message: 'The power input for power supply 2 is lost. (합성)', MessageId: 'PSU0003' }] },
    [`${M}/LogServices/Lclog`]: { '@odata.id': `${M}/LogServices/Lclog`, Id: 'Lclog', Name: 'Lifecycle Controller Log', Entries: id(`${M}/LogServices/Lclog/Entries`) },
    [`${M}/LogServices/Lclog/Entries`]: { '@odata.id': `${M}/LogServices/Lclog/Entries`, 'Members@odata.count': 1, Members: [{ '@odata.id': `${M}/LogServices/Lclog/Entries/1`, Id: '1', Created: '2026-10-26T09:00:00-05:00', Severity: 'OK', Message: 'Successfully logged in (합성)', MessageId: 'USR0030' }] },
    [`${M}/VirtualMedia`]: col(`${M}/VirtualMedia`, [`${M}/VirtualMedia/CD`]),
    [`${M}/VirtualMedia/CD`]: { '@odata.id': `${M}/VirtualMedia/CD`, Id: 'CD', MediaTypes: ['CD', 'DVD'], Inserted: false },
    [`${R}/AccountService`]: { '@odata.id': `${R}/AccountService`, AccountLockoutThreshold: 0, MinPasswordLength: 4, Accounts: id(`${R}/AccountService/Accounts`) },
    [`${R}/AccountService/Accounts`]: col(`${R}/AccountService/Accounts`, [`${R}/AccountService/Accounts/2`]),
    [`${R}/AccountService/Accounts/2`]: { '@odata.id': `${R}/AccountService/Accounts/2`, Id: '2', UserName: 'root', RoleId: 'Administrator', Enabled: true, Locked: false },
    [`${R}/SessionService`]: { '@odata.id': `${R}/SessionService`, Sessions: id(`${R}/SessionService/Sessions`) },
    [`${R}/EventService`]: { '@odata.id': `${R}/EventService`, ServiceEnabled: true, Subscriptions: id(`${R}/EventService/Subscriptions`), ServerSentEventUri: '/redfish/v1/SSE' },
    [`${R}/EventService/Subscriptions`]: col(`${R}/EventService/Subscriptions`, []),
    [`${R}/UpdateService`]: { '@odata.id': `${R}/UpdateService`, FirmwareInventory: id(`${R}/UpdateService/FirmwareInventory`) },
    [`${R}/UpdateService/FirmwareInventory`]: col(`${R}/UpdateService/FirmwareInventory`, ['Installed-25227-7.00.00.00', 'Installed-159-1.15.0', 'Previous-159-1.14.1'].map((x) => `${R}/UpdateService/FirmwareInventory/${x}`)),
    [`${R}/UpdateService/FirmwareInventory/Installed-25227-7.00.00.00`]: { '@odata.id': `${R}/UpdateService/FirmwareInventory/Installed-25227-7.00.00.00`, Id: 'Installed-25227-7.00.00.00', Name: 'Integrated Dell Remote Access Controller', Version: '7.00.00.00', Updateable: true },
    [`${R}/UpdateService/FirmwareInventory/Installed-159-1.15.0`]: { '@odata.id': `${R}/UpdateService/FirmwareInventory/Installed-159-1.15.0`, Id: 'Installed-159-1.15.0', Name: 'BIOS', Version: '1.15.0', Updateable: true },
    [`${R}/UpdateService/FirmwareInventory/Previous-159-1.14.1`]: { '@odata.id': `${R}/UpdateService/FirmwareInventory/Previous-159-1.14.1`, Id: 'Previous-159-1.14.1', Name: 'BIOS', Version: '1.14.1', Updateable: true },
    [`${R}/TelemetryService`]: { '@odata.id': `${R}/TelemetryService`, ServiceEnabled: true, MetricReports: id(`${R}/TelemetryService/MetricReports`) },
    [`${R}/TelemetryService/MetricReports`]: col(`${R}/TelemetryService/MetricReports`, [`${R}/TelemetryService/MetricReports/SystemUsage`]),
    [`${R}/TelemetryService/MetricReports/SystemUsage`]: { '@odata.id': `${R}/TelemetryService/MetricReports/SystemUsage`, Id: 'SystemUsage', Timestamp: '2026-10-27T00:40:00Z', MetricValues: [{ MetricId: 'CPUUsage', MetricValue: '23' }, { MetricId: 'MemoryUsage', MetricValue: '41' }, { MetricId: 'IOUsage', MetricValue: '3' }] },
    [`${R}/LicenseService`]: { '@odata.id': `${R}/LicenseService`, Licenses: id(`${R}/LicenseService/Licenses`) },
    [`${R}/LicenseService/Licenses`]: col(`${R}/LicenseService/Licenses`, [`${R}/LicenseService/Licenses/FIX1`]),
    [`${R}/LicenseService/Licenses/FIX1`]: { '@odata.id': `${R}/LicenseService/Licenses/FIX1`, Id: 'FIX1', Name: 'iDRAC9 Datacenter License (합성)', LicenseType: 'Production', EntitlementId: 'FIX1' },
  };
  return f;
}

/** 목 서버별 설정 — 인증 방식·$expand 지원 여부. */
export const MOCK_PROFILES = {
  supermicro: { fixture: supermicroFixture, username: 'ADMIN', password: 'ADMIN', basic: true, expand: false },
  dell: { fixture: dellFixture, username: 'root', password: 'calvin', basic: true, expand: true },
};
