import { execFile } from 'node:child_process'

/** Puts the computer to sleep or shuts it down. */
export function powerAction(action: 'sleep' | 'shutdown'): void {
  const run = (cmd: string, args: string[]): void => {
    execFile(cmd, args, { windowsHide: true }, (error) => {
      if (error) console.error('[mascot] could not', action, error.message)
    })
  }
  if (process.platform === 'win32') {
    if (action === 'shutdown') run('shutdown', ['/s', '/t', '0'])
    else run('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0'])
  } else if (process.platform === 'darwin') {
    if (action === 'shutdown') run('osascript', ['-e', 'tell app "System Events" to shut down'])
    else run('pmset', ['sleepnow'])
  } else {
    run('systemctl', [action === 'shutdown' ? 'poweroff' : 'suspend'])
  }
}
