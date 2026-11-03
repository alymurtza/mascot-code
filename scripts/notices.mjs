// Writes THIRD_PARTY_NOTICES.md: the licence of every library shipped inside the app, and of
// the fonts. Run after installing dependencies: node scripts/notices.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const dirs = execFileSync(npm, ['ls', '--omit=dev', '--all', '--parseable'], {
  encoding: 'utf8',
  shell: process.platform === 'win32'
})
  .split(/\r?\n/)
  .slice(1)
  .filter(Boolean)

const seen = new Map()
for (const dir of dirs) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const key = `${pkg.name}@${pkg.version}`
  if (seen.has(key)) continue
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f))
  const license =
    typeof pkg.license === 'string' ? pkg.license : (pkg.licenses?.[0]?.type ?? 'See the package')
  seen.set(key, {
    name: pkg.name,
    version: pkg.version,
    license,
    text: file ? readFileSync(join(dir, file), 'utf8').trim() : ''
  })
}

const fonts = ['instrument-sans', 'fredoka', 'jetbrains-mono']
  .map((f) => join('node_modules', '@fontsource', f))
  .filter((d) => existsSync(d))
  .map((d) => {
    const pkg = JSON.parse(readFileSync(join(d, 'package.json'), 'utf8'))
    const file = readdirSync(d).find((f) => /^licen[cs]e/i.test(f))
    return {
      name: pkg.name,
      version: pkg.version,
      license: pkg.license,
      text: file ? readFileSync(join(d, file), 'utf8').trim() : ''
    }
  })

const section = (e) =>
  `## ${e.name} ${e.version}\n\nLicence: ${e.license}\n\n${e.text ? '```\n' + e.text + '\n```\n' : ''}`
const out = [
  '# Third-party notices',
  '',
  'Mascot includes the open-source software below, each under its own licence.',
  'Electron and Chromium licences ship alongside the app (LICENSE.electron.txt, LICENSES.chromium.html).',
  'node-datachannel is used unchanged under the Mozilla Public License 2.0; its source is at https://github.com/murat-dogan/node-datachannel.',
  '',
  '# Fonts',
  '',
  ...fonts.map(section),
  '# Libraries',
  '',
  ...[...seen.values()].sort((a, b) => a.name.localeCompare(b.name)).map(section)
].join('\n')
writeFileSync('THIRD_PARTY_NOTICES.md', out)
console.log(`THIRD_PARTY_NOTICES.md: ${seen.size} libraries, ${fonts.length} fonts`)
