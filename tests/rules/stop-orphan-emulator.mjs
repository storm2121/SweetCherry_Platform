// On Windows, `firebase emulators:exec` stops its hub but can leave the
// Firestore emulator's Java process running on its port, so the next run
// fails with "port taken". This stops only that process: a Java Firestore
// emulator listening on this suite's own port (see firebase.rules-test.json).
import { execFileSync } from 'node:child_process';

const PORT = 8580;

if (process.platform === 'win32') {
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'java.exe' -and $_.CommandLine -match 'cloud-firestore-emulator' -and $_.CommandLine -match '--port ${PORT}( |$)' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; $_.ProcessId }`;
  const stopped = execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { encoding: 'utf8' }).trim();
  if (stopped) console.log(`Stopped leftover Firestore emulator (pid ${stopped.split(/\s+/).join(', ')}).`);
}
