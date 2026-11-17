import html
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
guides = json.loads((root / 'backend/projects/data/homeowner_guides_v1.json').read_text(encoding='utf-8'))
out = root / 'docs/guide-previews'
out.mkdir(parents=True, exist_ok=True)
esc = html.escape
css = '''body{margin:0;background:#f5f6f8;color:#122238;font:17px/1.75 system-ui,sans-serif}header{background:#071b34;color:white;padding:28px max(20px,calc((100% - 1040px)/2))}header b{color:#fcd34d}main{max-width:1040px;margin:auto;padding:30px 20px 80px}nav{display:flex;gap:14px;flex-wrap:wrap}a{color:#1e40af}nav a{background:white;padding:12px 18px;border-radius:12px;font-weight:700}article{background:white;border:1px solid #d7e0e9;border-radius:24px;padding:clamp(20px,5vw,60px);margin:35px 0}h1{font-size:clamp(30px,5vw,48px);line-height:1.15}h2{font-size:25px;line-height:1.3;margin-top:36px}h3{font-size:21px;line-height:1.4}p{white-space:pre-line}aside{background:#fff7dc;border-left:5px solid #fbbf24;padding:16px 22px}.step{border:1px solid #d7e0e9;border-radius:16px;padding:10px 24px;margin:18px 0}.tag{text-transform:uppercase;letter-spacing:.15em;color:#1e40af;font-size:13px;font-weight:800}.summary{font-size:21px;color:#42556e}.next{background:#071b34;color:white;border-radius:18px;padding:22px}footer{font-size:14px;color:#53657b} @media print{header,nav{display:none}body{background:white;font-size:11pt}main{padding:0}article{border:0;padding:0;break-after:page}.step{break-inside:avoid}a{color:#122238}}'''
nav = '<nav>' + ''.join(f'<a href="{esc(g["slug"])}.html">{esc(label)}</a>' for g,label in zip(guides,['Bathroom renovation','Backyard shed','Deck','Patio'])) + '</nav>'
for g in guides:
    parts = [f'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{esc(g["title"])} - review copy</title><style>{css}</style><header><strong>MyHome<b>Bro</b></strong> � Homeowner project guides</header><main>{nav}<article><p class="tag">Editorial preview � not published</p><h1>{esc(g["title"])}</h1><p class="summary">{esc(g["summary"])}</p><aside>Prepared for owner review. Product and local requirements need to be checked for the actual project. DIY instructions below cover only their stated scope.</aside><nav style="margin-top:20px"><a href="#diy">Explore DIY tasks</a><a href="#hire">Prepare to hire</a></nav>']
    for title,key in [('What this project involves','intro'),('Scope checklist','scope'),('Before you begin','preparation'),('Safety and stopping points','safety'),('Budget: what to include','cost'),('Tools and materials','tools'),('Common mistakes','mistakes')]:
        parts.append(f'<section><h2>{esc(title)}</h2><p>{esc(g[key])}</p></section>')
    for key,title,body in g['sections']:
        if key=='diy-readiness': parts.append('<h2 id="diy">Your DIY walkthrough</h2>')
        if key=='hire-scope': parts.append('<h2 id="hire">Your contractor conversation checklist</h2>')
        parts.append(f'<section class="step"><h3>{esc(title)}</h3><p>{esc(body)}</p></section>')
    parts.append('<section class="next"><h2>Take the next step in MyHomeBro</h2><p>Build my DIY plan: after publication, start an editable checklist using the scoped DIY tasks. Sign in or create an account to save it.</p><p>Plan my contractor request: start a request linked to the guide, with contact information collected after the project details. Starting a request does not send contractor invitations.</p></section><h2>Questions homeowners ask</h2>')
    for q,a in g['faqs']: parts.append(f'<details class="step"><summary><strong>{esc(q)}</strong></summary><p>{esc(a)}</p></details>')
    parts.append('<h2>Sources and local checks</h2><ul>')
    for label,url in g['sources']: parts.append(f'<li><a href="{esc(url)}" target="_blank" rel="noopener noreferrer">{esc(label)}</a></li>')
    parts.append('</ul><footer>Source check: November 16, 2026. This is a review copy, not a recorded human approval. No project is submitted by opening this preview.</footer></article></main></html>')
    (out / f'{g["slug"]}.html').write_text(''.join(parts), encoding='utf-8')
print(f'Created {len(guides)} standalone review previews.')
