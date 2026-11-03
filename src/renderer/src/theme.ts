import { isSpecial, paletteFor, type Palette, type Settings } from '@shared/settings'
import { THEMES } from '@shared/themes'

export { THEMES }

/** The theme showing now: the chosen one, or Cream dark. */
export const paletteInUse = (s: Settings): Palette => paletteFor(s.palette)

/** Paints the page in the settings' theme. */
/** How solid panels are over a special theme's scene (100: not see-through). */
const PANEL_OPACITY = 85
const SEE_THROUGH = ['solid', 'raised']

export function applyTheme(s: Settings): void {
  const key = paletteInUse(s)
  const theme = THEMES[key]
  const root = document.documentElement
  root.classList.toggle('dark', theme.dark)
  root.dataset['backdrop'] = isSpecial(key) ? key : ''
  for (const [name, value] of Object.entries(theme.tokens))
    root.style.setProperty(
      '--' + name,
      // Special themes: panels let the moving scene show through a little.
      isSpecial(key) && SEE_THROUGH.includes(name)
        ? `color-mix(in srgb, ${value} ${PANEL_OPACITY}%, transparent)`
        : value
    )
}
