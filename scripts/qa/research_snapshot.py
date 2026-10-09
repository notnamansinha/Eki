"""Read-only repository/history census for the A-Z QA audit (no credentials in output)."""
import concurrent.futures
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(os.environ.get('EKI_QA_RESEARCH_DIR', str(Path(os.environ.get('TEMP', '/tmp')) / 'eki-az-qa-2026-10-03')))
OUT.mkdir(parents=True, exist_ok=True)

def gh(path):
    p = subprocess.run(['gh', 'api', '--paginate', '--slurp', path], capture_output=True, text=True, encoding='utf-8', check=True)
    pages = json.loads(p.stdout)
    return [item for page in pages for item in page] if isinstance(pages[0], list) else pages[0]

def save(name, value):
    (OUT / name).write_text(json.dumps(value, indent=2, ensure_ascii=False), encoding='utf-8')

prs = gh('repos/notnamansinha/Eki/pulls?state=all&per_page=100')
issues = [x for x in gh('repos/notnamansinha/Eki/issues?state=all&per_page=100') if 'pull_request' not in x]
save('pulls.json', prs)
save('issues.json', issues)
save('pulls-current.json', prs)
save('issues-current.json', issues)

def pull_detail(pr):
    n = pr['number']
    for kind, path in [('detail', f'pulls/{n}'), ('files', f'pulls/{n}/files?per_page=100'), ('comments', f'issues/{n}/comments?per_page=100'), ('reviews', f'pulls/{n}/reviews?per_page=100'), ('inline-comments', f'pulls/{n}/comments?per_page=100')]:
        try:
            save(f'pr-{n}-{kind}.json', gh(f'repos/notnamansinha/Eki/{path}'))
        except Exception as exc:
            save(f'pr-{n}-{kind}-error.json', {'error': str(exc)})
    return n

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
    list(executor.map(pull_detail, prs))

def issue_detail(issue):
    n = issue['number']
    save(f'issue-{n}-comments.json', gh(f'repos/notnamansinha/Eki/issues/{n}/comments?per_page=100'))
    return n

with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
    list(executor.map(issue_detail, issues))

paths = subprocess.check_output(['git', 'ls-files'], cwd=ROOT, text=True, encoding='utf-8').splitlines()
ledger = []
for name in paths:
    data = (ROOT / name).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    try:
        text = data.decode('utf-8')
        binary = '\x00' in text
    except UnicodeDecodeError:
        binary = True
        text = ''
    row = {'path': name, 'bytes': len(data), 'sha256': digest, 'binary': binary, 'lines': len(text.splitlines())}
    if not binary:
        row['exports'] = re.findall(r'(?:export\s+(?:async\s+)?(?:function|class|const|interface|type)|(?:static\s+)?(?:inline\s+)?(?:bool|void|uint\w*|int\w*)\s+)\s*(\w+)', text)
        row['tests'] = re.findall(r'(?:it|test|describe)\s*(?:\.\w+)?\s*\(\s*[\'\"]([^\'\"]+)', text)
        row['handlers'] = re.findall(r'\b(?:router|app)\.(get|post|put|patch|delete|use)\(\s*[\'\"]([^\'\"]+)', text)
        row['controls'] = re.findall(r'(?:aria-label|title|placeholder)=[\'\"]([^\'\"]+)', text)
        # A complete text snapshot supports repeatable inspection without changing the branch.
        dest = OUT / 'files' / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_text(text.replace('\r\n', '\n'), encoding='utf-8', newline='\n')
    ledger.append(row)
save('files.json', ledger)
save('snapshot.json', {'captured_at_utc': dt.datetime.now(dt.timezone.utc).isoformat(), 'commit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(), 'tracked_files': len(paths), 'pull_requests': len(prs), 'issues': len(issues), 'issue_window_start_utc': '2026-09-29T16:30:44Z', 'issue_window_end_utc': '2026-10-03T16:30:44Z'})
print(json.dumps({'directory': str(OUT), 'files': len(ledger), 'prs': len(prs), 'issues': len(issues)}))
