"""Copies the font files of the private fonts repository into the site being deployed.

    python3 private_fonts.py SOURCE_DIR OUT_DIR

Every TTF, OTF, WOFF and WOFF2 file under SOURCE_DIR (any folder) is copied to OUT_DIR, keeping
its folder; WOFF2 files are unpacked to TTF/OTF, which the font lab can read. OUT_DIR/index.json
lists them for the font lab: [{"file": URL path, "name": "Family Style"}], sorted by name.
"""
import json, os, shutil, sys, urllib.parse
from fontTools.ttLib import TTFont

FONT_EXT = ('.ttf', '.otf', '.woff', '.woff2')


def family_name(font, fallback):
    names = font['name'] if 'name' in font else None
    if names is None:
        return fallback
    def get(i):
        rec = names.getName(i, 3, 1, 0x409) or names.getName(i, 1, 0, 0) or names.getDebugName(i)
        return str(rec) if rec else None
    family = get(16) or get(1)
    style = get(17) or get(2)
    if not family:
        return fallback
    return family if not style or style.lower() in ('regular', 'normal') else family + ' ' + style


def main(src, out):
    os.makedirs(out, exist_ok=True)
    fonts = []
    for root, dirs, files in os.walk(src):
        dirs[:] = sorted(d for d in dirs if not d.startswith('.'))
        for name in sorted(files):
            if not name.lower().endswith(FONT_EXT):
                continue
            path = os.path.join(root, name)
            rel = os.path.relpath(path, src)
            try:
                font = TTFont(path, fontNumber=0)
            except Exception as e:  # not a font fontTools can read: leave it out
                print(f'::warning::{rel} skipped: {e}')
                continue
            if rel.lower().endswith('.woff2'):
                font.flavor = None
                rel = rel[:-6] + ('.otf' if font.sfntVersion == 'OTTO' else '.ttf')
                os.makedirs(os.path.dirname(os.path.join(out, rel)) or out, exist_ok=True)
                font.save(os.path.join(out, rel))
            else:
                os.makedirs(os.path.dirname(os.path.join(out, rel)) or out, exist_ok=True)
                shutil.copyfile(path, os.path.join(out, rel))
            fonts.append({'file': urllib.parse.quote(rel.replace(os.sep, '/')), 'name': family_name(font, os.path.splitext(name)[0])})
    # the same name twice: tell them apart by file
    seen = {}
    for f in fonts:
        seen[f['name']] = seen.get(f['name'], 0) + 1
    for f in fonts:
        if seen[f['name']] > 1:
            f['name'] += ' (' + urllib.parse.unquote(f['file']) + ')'
    fonts.sort(key=lambda f: f['name'].lower())
    with open(os.path.join(out, 'index.json'), 'w') as fh:
        json.dump(fonts, fh, indent=1)
    print(f'{len(fonts)} private font(s) added to the site')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
