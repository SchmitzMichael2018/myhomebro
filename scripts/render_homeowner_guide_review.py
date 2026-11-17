"""Render the owner review document from the editorial catalog."""
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
guides = json.loads((root / 'backend/projects/data/homeowner_guides_v1.json').read_text(encoding='utf-8'))
parts = ['# Homeowner project guides - review copy',
         'Prepared for Michael Schmitz / MyHomeBro. Drafts awaiting human editorial review; not published. Bathroom and patio checked November 16, 2026; shed and deck revised November 17, 2026.',
         'Bathroom renovation, shed, deck and patio guides include planning, defined DIY workflows and hiring checklists. Permit exemptions are explained separately from DIY suitability.']
fields = [('What this project involves', 'intro'), ('Scope checklist', 'scope'), ('Before you begin', 'preparation'), ('Safety and stopping points', 'safety'), ('Budget: what to include', 'cost'), ('Tools and materials', 'tools'), ('Common mistakes', 'mistakes'), ('DIY suitability', 'diy'), ('When to hire help', 'pro')]
for guide in guides:
    parts += ['---', '# '+guide['title'], guide['summary']]
    for title,key in fields:
        parts += ['## '+title, guide[key]]
    for key,title,body in guide['sections']:
        parts += ['## '+title, body]
    parts += ['## Choose your next step', '**Build my DIY plan:** after publication, create an editable project from the five scoped DIY steps. Sign in or create an account to save it.', '**Plan my contractor request:** begin a guide-linked request, with project details collected before contact information. Starting a request does not send contractor invitations.', '## Questions homeowners ask']
    for q,a in guide['faqs']:
        parts += ['**'+q+'**', a]
    parts += ['## Sources to verify', '\n'.join(f'- [{label}]({url})' for label,url in guide['sources'])]
(root / 'docs/HOMEOWNER_GUIDES_REVIEW.md').write_text('\n\n'.join(parts)+'\n', encoding='utf-8')
print('Rendered four-guide review document.')
