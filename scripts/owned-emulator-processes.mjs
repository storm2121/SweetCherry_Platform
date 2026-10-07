import { spawnSync } from 'node:child_process';

const powershell = (script) => {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', script], {
    encoding: 'utf8', windowsHide: true, timeout: 10000,
  });
  if (result.status !== 0) throw new Error('Could not inspect the owned Windows emulator processes.');
  return result.stdout.trim();
};

export const captureEmulatorJavaChildren = (parentPid) => {
  if (process.platform !== 'win32' || !Number.isInteger(parentPid)) return [];
  const output = powershell(`$candidates = @(Get-CimInstance Win32_Process -Filter "Name = 'java.exe'" | Where-Object { $_.CommandLine -match 'cloud-(firestore-emulator|storage-rules-runtime)' }); $owned = [Collections.Generic.HashSet[int]]::new(); $null = $owned.Add(${parentPid}); do { $added = $false; foreach ($candidate in $candidates) { if ($owned.Contains($candidate.ParentProcessId) -and !$owned.Contains($candidate.ProcessId)) { $null = $owned.Add($candidate.ProcessId); $added = $true } } } while ($added); $candidates | Where-Object { $owned.Contains($_.ProcessId) } | ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; parent=$_.ParentProcessId; started=$_.CreationDate.ToUniversalTime().Ticks.ToString() } } | ConvertTo-Json -Compress`);
  if (!output) return [];
  const records = JSON.parse(output);
  return Array.isArray(records) ? records : [records];
};

export const stopCapturedEmulatorJava = (records) => {
  if (process.platform !== 'win32') return;
  for (const record of [...records].reverse()) {
    if (!Number.isInteger(record.pid) || !Number.isInteger(record.parent) || !/^\d{1,20}$/.test(record.started)) continue;
    // PID, parent, creation time and emulator command must all still match.
    powershell(`Get-CimInstance Win32_Process -Filter "ProcessId = ${record.pid}" | Where-Object { $_.Name -eq 'java.exe' -and $_.ParentProcessId -eq ${record.parent} -and $_.CreationDate.ToUniversalTime().Ticks.ToString() -eq '${record.started}' -and $_.CommandLine -match 'cloud-(firestore-emulator|storage-rules-runtime)' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`);
  }
};
