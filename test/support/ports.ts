import { connect } from 'node:net'

/** The extension's ports must be free: if a real Mascot is running (on Windows, WSL shares its
 * local ports), the tests would talk to it and send it test downloads. */
export async function bridgePortsFree(): Promise<void> {
  for (const port of [19400, 19401, 19402]) {
    const open = await new Promise<boolean>((resolve) => {
      const socket = connect(port, '127.0.0.1')
      socket.once('connect', () => {
        socket.destroy()
        resolve(true)
      })
      socket.once('error', () => resolve(false))
      socket.setTimeout(800, () => {
        socket.destroy()
        resolve(false)
      })
    })
    if (open)
      throw new Error(
        `Port ${port}, which the browser extension uses, is taken: probably by Mascot itself ` +
          '(WSL shares Windows’ local ports). Quit Mascot and run these tests again.'
      )
  }
}
