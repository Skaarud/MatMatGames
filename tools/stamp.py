#!/usr/bin/env python3
"""Stamp a release: version every JS/CSS file in index.html so browsers never run stale code,
and write version.json so open hubs can say 'new version available'. Run before each push."""
import json, pathlib, re, time
root = pathlib.Path(__file__).resolve().parent.parent
v = time.strftime('%Y%m%d%H%M%S')
html = (root / 'index.html').read_text()
js = sorted(p.relative_to(root).as_posix() for p in (root / 'assets/js').glob('*.js'))
imports = {'three': f'./vendor/three/build/three.module.min.js', 'three/addons/': './vendor/three/addons/'}
for p in js:
    imports['./' + p] = f'./{p}?v={v}'
imap = '<script type="importmap">\n' + json.dumps({'imports': imports}, indent=1) + '\n</script>'
html = re.sub(r'<script type="importmap">.*?</script>', imap, html, flags=re.S)
html = re.sub(r'(assets/css/[\w-]+\.css)(\?v=\d+)?', rf'\1?v={v}', html)
html = re.sub(r'src="assets/js/main\.js(\?v=\d+)?"', f'src="./assets/js/main.js?v={v}"', html)
html = re.sub(r'src="\./assets/js/main\.js(\?v=\d+)?"', f'src="./assets/js/main.js?v={v}"', html)
html = re.sub(r'<meta name="hub-version" content="\d*">', f'<meta name="hub-version" content="{v}">', html)
if 'name="hub-version"' not in html:
    html = html.replace('<meta charset="utf-8">', f'<meta charset="utf-8">\n<meta name="hub-version" content="{v}">')
(root / 'index.html').write_text(html)
(root / 'version.json').write_text(json.dumps({'version': v}) + '\n')
print('stamped', v)
