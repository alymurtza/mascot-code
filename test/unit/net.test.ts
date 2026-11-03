import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { test } from 'node:test'
import { classify } from '../../src/main/net/adapters'
import { Connection } from '../../src/main/net/http'

test('adapters are classified by name and description', () => {
  assert.equal(classify('Wi-Fi'), 'wifi')
  assert.equal(classify('wlp2s0'), 'wifi')
  assert.equal(classify('Ethernet 2', 'Realtek PCIe GbE Family Controller'), 'ethernet')
  assert.equal(classify('enp3s0'), 'ethernet')
  assert.equal(classify('vEthernet (WSL)', 'Hyper-V Virtual Ethernet Adapter'), 'virtual')
  assert.equal(classify('docker0'), 'virtual')
  assert.equal(classify('Ethernet 4', 'Remote NDIS based Internet Sharing Device'), 'usb')
  assert.equal(classify('en5', 'iPhone USB'), 'usb')
})

test('a connection leaves from its adapter’s address and is reused', async () => {
  process.env['MASCOT_TEST_ADAPTERS'] = 'A=127.0.0.2'
  const seen: string[] = []
  const sockets = new Set<unknown>()
  const server = createServer((req, res) => {
    seen.push(req.socket.remoteAddress ?? '')
    sockets.add(req.socket)
    res.end('ok')
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const port = (server.address() as AddressInfo).port
  const connection = new Connection(() => ({
    id: 'A',
    name: 'A',
    kind: 'ethernet',
    ipv4: '127.0.0.2'
  }))
  for (let i = 0; i < 3; i++) {
    const res = await connection.request(new URL(`http://127.0.0.1:${port}/`), { timeoutMs: 5000 })
    let body = ''
    for await (const chunk of res) body += chunk
    assert.equal(body, 'ok')
  }
  assert.deepEqual(seen, ['127.0.0.2', '127.0.0.2', '127.0.0.2'])
  assert.equal(sockets.size, 1, 'one socket, kept alive')
  connection.reset()
  server.close()
})
