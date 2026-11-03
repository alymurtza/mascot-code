"""Generates Mascot's theme tokens and checks their contrast (WCAG 2.x ratios).
Run: python3 themes.py > themes.json ; exits non-zero if any check fails."""
import json, math, sys

def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def lin_to_srgb(c):
    c = max(0.0, min(1.0, c))
    return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055

def hex_to_rgb(h):
    h = h.lstrip('#'); return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
def rgb_to_hex(rgb):
    return '#' + ''.join('%02x' % round(max(0, min(1, v)) * 255) for v in rgb)

def oklch_to_hex(L, C, H):
    a = C * math.cos(math.radians(H)); b = C * math.sin(math.radians(H))
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_ ** 3, m_ ** 3, s_ ** 3
    r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    return rgb_to_hex([lin_to_srgb(r), lin_to_srgb(g), lin_to_srgb(bl)])

def hex_to_oklch(h):
    r, g, b = (srgb_to_lin(v) for v in hex_to_rgb(h))
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = l ** (1 / 3), m ** (1 / 3), s ** (1 / 3)
    L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_
    a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
    bb = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    return L, math.hypot(a, bb), math.degrees(math.atan2(bb, a)) % 360

def lum(h):
    r, g, b = (srgb_to_lin(v) for v in hex_to_rgb(h)); return 0.2126 * r + 0.7152 * g + 0.0722 * b
def contrast(a, b):
    x, y = sorted((lum(a), lum(b)), reverse=True); return (x + 0.05) / (y + 0.05)

def rgba(h, alpha):
    r, g, b = (round(v * 255) for v in hex_to_rgb(h)); return f'rgb({r} {g} {b} / {alpha})'

def shift_until(h, against, target, direction):
    """Moves a colour's lightness (keeping hue) until it reaches `target` contrast."""
    L, C, H = hex_to_oklch(h)
    out = h
    while contrast(out, against) < target and 0 < L < 1:
        L += 0.005 * direction
        out = oklch_to_hex(L, C, H)
    return out

# name, accent, surface hue, surface chroma (dark, light), network hues
THEMES = [
    ('cream', 'Cream', '#eedab9', 70, (0.012, 0.010)),
    ('rose', 'Rose', '#f0708f', 5, (0.014, 0.008)),
    ('ember', 'Ember', '#f2683f', 35, (0.010, 0.008)),
    ('champagne', 'Champagne', '#dcab62', 270, (0.025, 0.006)),
    ('sunflower', 'Sunflower', '#e9c046', 95, (0.008, 0.010)),
    ('forest', 'Forest', '#62c26a', 150, (0.014, 0.010)),
    ('mint', 'Mint', '#3fd0a0', 200, (0.008, 0.006)),
    ('ocean', 'Ocean', '#2fb9d8', 225, (0.030, 0.010)),
    ('blue', 'Blue', '#4b8cff', 260, (0.0, 0.004)),
    ('violet', 'Violet', '#a080ff', 290, (0.022, 0.010)),
]

# The app's own espresso surfaces, kept exactly for Cream dark.
ESPRESSO = {
    'bg': '#14100d', 'solid': '#1a1511', 'raised': '#221b16', 'line': '#33291f',
    'line-soft': '#2a221b', 'ink': '#f2ebe4', 'muted': '#ad9f92', 'faint': '#7d7064'
}

def surfaces(hue, chroma, dark):
    if dark:
        Ls = dict(bg=.165, solid=.19, raised=.222, line=.30, **{'line-soft': .255}, ink=.95, muted=.75, faint=.60)
    else:
        Ls = dict(bg=.968, solid=.995, raised=.982, line=.895, **{'line-soft': .93}, ink=.24, muted=.47, faint=.58)
    out = {}
    for k, L in Ls.items():
        c = chroma * (0.6 if k in ('ink',) else 1)
        out[k] = oklch_to_hex(L, c, hue)
    return out

def network_colours(accent, dark, bg, solid):
    """Three hues spread away from the accent and each other."""
    _, _, ah = hex_to_oklch(accent)
    picks = []
    candidates = [150, 245, 310, 25, 85, 195]  # green, blue, purple, red, amber, teal
    def dist(a, b):
        d = abs(a - b) % 360; return min(d, 360 - d)
    for h in candidates:
        if dist(h, ah) >= 45 and all(dist(h, p) >= 60 for p in picks):
            picks.append(h)
        if len(picks) == 3: break
    out = []
    for h in picks:
        c = oklch_to_hex(0.72 if dark else 0.56, 0.15, h)
        c = shift_until(c, bg, 3.0, 1 if dark else -1)
        c = shift_until(c, solid, 3.0, 1 if dark else -1)
        out.append(c)
    return dict(zip(('n-wifi', 'n-eth', 'n-usb'), out))

def tokens(key, accent, hue, chroma, dark):
    s = dict(ESPRESSO) if (key == 'cream' and dark) else surfaces(hue, chroma[0 if dark else 1], dark)
    bg, solid = s['bg'], s['solid']
    t = dict(s)
    if key == 'cream':
        # The app icon's cream as it is on dark; on the light page a deeper, toasted cream, so
        # buttons and progress still show.
        if not dark:
            accent = shift_until('#b49268', bg, 2.6, -1)
    else:
        # One accent for both modes: deep enough to show as a fill on the light page.
        light_bg = surfaces(hue, chroma[1], False)['bg']
        accent = shift_until(accent, light_bg, 2.6, -1)
    t['accent'] = accent
    L, C, H = hex_to_oklch(accent)
    t['accent-2'] = oklch_to_hex(min(.93, L + .12), C * .8, H)
    ink_dark = oklch_to_hex(.18, .03, H)
    t['accent-ink'] = ink_dark if contrast(accent, ink_dark) >= contrast(accent, '#ffffff') else '#ffffff'
    # Accent used as text or a thin icon on the page: same hue, shade adjusted only if needed.
    text = shift_until(accent, bg, 4.5, 1 if dark else -1)
    text = shift_until(text, solid, 4.5, 1 if dark else -1)
    t['accent-text'] = text
    t['accent-soft'] = rgba(accent, '.15' if dark else '.14')
    t['glow'] = rgba(accent, '.10' if dark else '.08')
    t.update(network_colours(accent, dark, bg, solid))
    return t

CHECKS = [  # (fg, bg, minimum, what)
    ('ink', 'bg', 7, 'body text'), ('ink', 'raised', 7, 'body text on raised'),
    ('muted', 'bg', 4.5, 'secondary text'), ('muted', 'solid', 4.5, 'secondary text on cards'),
    ('faint', 'solid', 3, 'hints'), ('accent-ink', 'accent', 4.5, 'text on accent buttons'),
    ('accent-text', 'bg', 4.5, 'accent text'), ('accent-text', 'solid', 4.5, 'accent text on cards'),
    ('accent', 'bg', 2.6, 'accent fill against page'),
    ('n-wifi', 'solid', 3, 'network colour'), ('n-eth', 'solid', 3, 'network colour'),
    ('n-usb', 'solid', 3, 'network colour'),
]

failed = []
out = {}
report = []
for key, name, accent, hue, chroma in THEMES:
    entry = {'name': name}
    for mode in ('dark', 'light'):
        t = tokens(key, accent, hue, chroma, mode == 'dark')
        entry[mode] = t
        for fg, bgk, minimum, what in CHECKS:
            r = contrast(t[fg], t[bgk])
            report.append(f'{name:10} {mode:5} {fg:>11} on {bgk:9} {r:5.2f} (min {minimum})')
            if r < minimum:
                failed.append(f'{name} {mode}: {what} {fg} on {bgk} = {r:.2f} < {minimum}')
    out[key] = entry

print(json.dumps(out, indent=2))
print('\n'.join(report), file=open(sys.argv[1] if len(sys.argv) > 1 else '/dev/null', 'w'))
for f in failed: print('FAIL', f, file=sys.stderr)
sys.exit(1 if failed else 0)
