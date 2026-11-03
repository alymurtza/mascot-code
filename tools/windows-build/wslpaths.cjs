// Under WSL there's no wine Z: drive: electron-builder's Z:\ paths go to this distro's share
// (\\wsl.localhost\<distro>\...) instead.
const path = require('node:path')

const distro = process.env.WSL_DISTRO_NAME
if (!distro) throw new Error('Run the Windows build from WSL (WSL_DISTRO_NAME is not set)')
const root = `\\\\wsl.localhost\\${distro}`
const join = path.win32.join
path.win32.join = (first, ...rest) =>
  first === 'Z:' && typeof rest[0] === 'string' && rest[0].startsWith('/')
    ? root + rest.join('/').replace(/\//g, '\\')
    : join(first, ...rest)
