"""Build evidence appendices only; never execute app modules or tests."""
import json
import os
from pathlib import Path
import re
import hashlib
from urllib.parse import quote

ROOT = Path(__file__).resolve().parents[2]
DATA = Path(os.environ.get('EKI_QA_RESEARCH_DIR', str(Path(os.environ['TEMP']) / 'eki-az-qa-2026-10-03')))
PLAN = ROOT / 'docs/testing/WEBAPP_A_Z_AB_TESTING_PLAN.md'
COMMIT = '722ab6e1489290cafda3d2cf30821f5c193acf86'
BASE = f'https://github.com/notnamansinha/Eki/blob/{COMMIT}/'
START, END = '2026-09-30T05:35:25Z', '2026-10-04T05:35:25Z'

def read(name):
    return json.loads((DATA / name).read_text(encoding='utf-8-sig'))

def tidy(value):
    text = str(value or '').replace('\r', '').strip()
    text = re.sub(r'gh[pousr]_[A-Za-z0-9]{20,}', '[REDACTED_TOKEN]', text)
    return text

def cell(value, length=None):
    text = re.sub(r'\s+', ' ', tidy(value)).replace('|', '\\|').replace('`', "'")
    if length and len(text) > length:
        return text[:length - 1] + '…'
    return text or '—'

def src(file, line=None):
    return f'[{file}{":"+str(line) if line else ""}]({BASE}{quote(file, safe="/")}{"#L"+str(line) if line else ""})'

def domain(path):
    p = path.lower()
    for keys, group in [
        (['telemetry','devices','livebus','activebus','smoothposition','motion','freshness'], 'GNSS / MAP / OBS'),
        (['trip','direction','matching','rerout','serialized','checkpoint'], 'TRIP / GNSS / DATA'),
        (['boarding','sessions','shifts','driverdashboard'], 'BOARD / OPS / TRIP / CHAT'),
        (['privacy','retention','history','deletion'], 'DATA / HIST'),
        (['feedback'], 'FEED'), (['message','chat'], 'CHAT'), (['setting'], 'SET'),
        (['route','places','polyline','geo.'], 'ROUTE / MAP / TRIP'),
        (['fleet','driver','operator','claim'], 'FLEET / OPS / AUTH'),
        (['auth','firebase','guard','appcheck','middleware','rules'], 'AUTH / SEC / API'),
        (['passenger','account','inappselect','modal','select'], 'PAX / BOARD / C01–C22'),
        (['firmware','hardware'], 'FW / GNSS'),
        (['workflow','docker','deploy','build','package','lock','tsconfig','config','audit'], 'REL / WEB / SEC'),
        (['health','observ','metric','trace'], 'OBS / API'),
        (['sw','pwa','manifest','sitemap','robots','metadata','icon','logo','public'], 'WEB / REL'),
    ]:
        if any(k in p for k in keys): return group
    return 'C01–C22 / H01–H18 / REL (as applicable)'

issue_cases = {
    245:'All P0/P1 cases; S5/S6 and release gates', 241:'GNSS34 / MAP16',
    240:'GNSS05 / MAP19', 239:'GNSS20–GNSS26', 237:'FW07–FW10',
    235:'PAX04 / MAP11', 234:'SEC13 / REL01', 233:'SEC13 / REL01',
    231:'OPS01–OPS02 / MAP14 / AUTH12', 230:'OPS04–OPS06 / OPS13 / PAX17 / C09',
    229:'PAX11–PAX16 / MAP08 / MAP20', 228:'PAX02–PAX03 / BOARD08',
    225:'MAP27–MAP29 / OBS01–OBS06 / AB01', 224:'FW05–FW10',
    221:'SET06–SET08 / C20', 220:'FEED12–FEED13', 219:'HIST03 / HIST06 / C12–C13',
    218:'C01 / C04 / PAX02 / PAX17', 217:'C09–C11 / H16 / CHAT09 / FEED07',
    216:'PAX01 / PAX09–PAX10 / C02 / C15', 214:'DATA08–DATA12',
    213:'MAP09 / MAP22', 212:'MAP04 / MAP10 / TRIP12',
    211:'GNSS28 / OBS01', 209:'HIST05 / DATA07 / DATA13',
    208:'FEED14 / REL03', 207:'TRIP09–TRIP10', 206:'TRIP06–TRIP09',
    196:'HTTP01–HTTP59 / H17', 195:'OBS01–OBS08 / AB03 / AB06 / S5',
    194:'ROUTE16–ROUTE18 / ROUTE26 / API06–API07 / AB04 / AB08',
    193:'BOARD01–BOARD22 / OPS04–OPS14 / TRIP10 / TRIP16–TRIP17 / H14',
    192:'H14 / API01 / ROUTE25 / SET02 / FEED12 / DATA01',
    191:'HTTP01–HTTP59 / H01–H18 / OBS / AB',
}

def issue_family(issue):
    return issue_cases.get(issue['number'], domain(issue['title']+' '+tidy(issue.get('body'))[:600]))

def purpose(file):
    p = file['path']
    if file['binary']: return 'Binary image asset; verify references, format, dimensions, rendering and export path; no executable logic.'
    if 'lock' in Path(p).name: return 'Dependency resolution/toolchain reproducibility; inspect locked versions and audit at future execution time.'
    if re.search(r'(\.test\.|\.spec\.|/test/|test_main)', p):
        names = [n['name'] for n in file.get('testNames', [])]
        return f'Regression definitions/support; {len(names)} statically named test/describe declarations. See Appendix F; declaration is not a pass.'
    headings = file.get('headings', [])
    if p.endswith('.md'): return 'Historical guidance/requirements, not authority over current source. Sections: ' + '; '.join(headings[:5])
    names = list(dict.fromkeys(file.get('exports', []) + [x['name'] for x in file.get('functions', [])]))
    handlers = file.get('handlers', [])
    parts = []
    if names: parts.append('Declared symbols: ' + ', '.join(names))
    if handlers: parts.append('Registered boundaries: ' + ', '.join(m.upper() + ' ' + route for m, route in handlers))
    if file.get('controls'): parts.append(f'{len(file["controls"])} static control occurrences; exercise in owning rendered state')
    if file.get('imports'): parts.append('Depends on: ' + ', '.join(file['imports'][:6]))
    if parts: return '; '.join(parts)
    if p.startswith('hardware/'): return 'Firmware policy/build/storage/configuration boundary; native vs board coverage must remain distinct.'
    if p.startswith('.github/'): return 'CI/deployment/repository automation configuration; validate triggers, immutable revision and environment gates.'
    if p.endswith(('.css', '.json', '.yaml', '.yml', '.toml', '.ini')): return 'Configuration/style/data boundary; verify schema, references, platform behavior and generated-output consistency.'
    return 'Supporting source/configuration artifact; inspect its contents and its consumers when implementing the mapped cases.'

ledger = read('catalog.json')
prs = read('pulls-current.json')
issues = read('issues-current.json')
openapi = json.loads((ROOT/'backend/openapi.json').read_text(encoding='utf-8'))
out = []
def add(text=''): out.append(text)

add('## Appendix A. Every tracked file: responsibilities and verification entry points\n')
add('All 504 tracked files are listed once. Byte counts/hashes are census evidence, not proof of semantic correctness. Static symbols/imports describe entry points; anonymous closures, generated paths and C++ symbols require reading the linked file. Documentation is labelled historical. Binary assets are not claimed to have executable semantics.\n')
add('| # | Source file | Lines / bytes | Role and how it connects | Case families | SHA256 (first12) |')
add('|---|---|---|---|---|---|')
for i, f in enumerate(ledger, 1):
    add(f'| F{i:03} | {src(f["path"])} | {f["lines"]} / {f["bytes"]} | {cell(purpose(f))} | {domain(f["path"])} | `{f["sha256"][:12]}` |')

add('\n## Appendix B. Every statically detected production control site\n')
add('Apply relevant C01–C22 checks and the owning family to each row. Expressions shown here are source expressions, not assumed literal accessible names. This includes native/custom controls plus every detected JSX event/callback boundary, including clickable containers, map events and state callbacks. For a callback-only boundary, trigger the owning interaction/data event rather than inventing a clickable button. Locate dynamic controls with their rendered role/name and row identity; expand repeated children into runtime elements. Separately exercise browser/SW actions specified in the main catalog.\n')
add('| Control ID | Source | Element / content | Input, activation and state wiring | Case family |')
add('|---|---|---|---|---|')
control_count = 0
for f in ledger:
    if not f['path'].startswith('frontend/src/') or '.test.' in f['path']: continue
    for c in f.get('controls', []):
        control_count += 1
        attrs = c['attrs']
        relevant = {k:v for k,v in attrs.items() if k.startswith('on') or k in ['aria-label','aria-labelledby','role','title','placeholder','type','name','value','checked','disabled','readOnly','required','maxLength','min','max','href','aria-expanded','aria-controls','options','label','isOpen','open','draggable']}
        wiring = '; '.join(k + '=' + v for k,v in relevant.items())
        add(f'| CTRL{control_count:03} | {src(f["path"],c["line"])} | `{c["tag"]}` ({c.get("kind","control")}) {cell(c["text"],300)} | {cell(wiring,1600)} | {domain(f["path"])}; relevant C01–C22 |')

add('\n## Appendix C. Complete current HTTP operation matrix\n')
add('Each row requires H01–H18 plus domain-specific assertions. Security scheme is authentication, not a complete role/ownership policy. Operation descriptions/schema are historical contract evidence; handler invariants are authoritative. No listener is invented as an HTTP endpoint.\n')
add('| API case | Method/path | Current summary | Auth scheme | Documented statuses | Family |')
add('|---|---|---|---|---|---|')
api_count = 0
for route, item in openapi['paths'].items():
    for method, op in item.items():
        if method not in ['get','post','put','patch','delete']: continue
        api_count += 1
        auth = ', '.join(k for block in op.get('security', []) for k in block) or 'public'
        add(f'| HTTP{api_count:02} | `{method.upper()} {route}` | {cell(op.get("summary"))} | {auth} | {", ".join(op.get("responses",{}))} | {domain(route)}; H01–H18 |')

add('\n## Appendix D. Complete PR history with exclusions and regression linkage\n')
add('All128 PR records were inventoried. Open/unmerged/closed-without-merge changes are not assumed present. A merge date indicates GitHub merge history, not independent proof that every original line survives in this commit. Source and mapped current cases take precedence. Descriptions and review/discussion excerpts below are attributed historical statements, not this audit\'s verified outcomes. Available GitHub patches may be truncated by GitHub; file links retain the review entry point.\n')
ui_prs = {129:'Branding/logo/assets and visual identity; excluded from non-UI historical requirements.',
          190:'Open passenger visual redesign; excluded and not assumed implemented.',
          244:'Passenger dropdown presentation PR; excluded from history requirements as UI. Current functional dropdown behavior is still covered.'}
for pr in sorted(prs, key=lambda p:p['number']):
    n = pr['number']
    detail = read(f'pr-{n}-detail.json')
    files = read(f'pr-{n}-files.json')
    state = 'MERGED '+str(pr['merged_at']) if pr.get('merged_at') else pr['state'].upper()+' / NOT MERGED'
    add(f'\n### PR{n}: [{cell(pr["title"])}]({pr["html_url"]})\n')
    add(f'- State: **{state}**; base `{detail["base"]["ref"]}`; head `{detail["head"]["ref"]}`.')
    if n in ui_prs:
        add('- Scope: **UI history excluded.** '+ui_prs[n]); continue
    groups = sorted(set(domain(f['filename']) for f in files))
    add('- Regression linkage: '+ '; '.join(groups)+'. Apply current cases, not historical pass claims.')
    add('- Changed files: '+ ', '.join(f'[{f["filename"]}]({pr["html_url"]}/files)' for f in files)+'.')
    body = tidy(pr.get('body'))
    if body:
        add('\n<details><summary>Recorded PR description (historical context)</summary>\n')
        add(body); add('\n</details>\n')
    comments = read(f'pr-{n}-comments.json')
    reviews = read(f'pr-{n}-reviews.json')
    discussion = [x for x in comments + reviews if tidy(x.get('body'))]
    if discussion:
        add('Review/discussion entry points (excerpts; source links retain full context):\n')
        for c in discussion:
            add(f'- [{c.get("state", "discussion")} {c.get("submitted_at") or c.get("created_at")}]({c.get("html_url") or pr["html_url"]}): {cell(c["body"],700)}')
    inline_file = DATA / f'pr-{n}-inline-comments.json'
    if inline_file.exists():
        inline = read(inline_file.name)
        if inline:
            add('\nInline review findings (historical; verify current source rather than assuming unresolved):\n')
            for c in inline:
                if tidy(c.get('body')):
                    add(f'- [{c.get("path")}:{c.get("line") or c.get("original_line") or "diff"}]({c["html_url"]}): {cell(c["body"],1300)}')
    introduced = []
    for f in files:
        for line in tidy(f.get('patch')).splitlines():
            if line.startswith('+') and not line.startswith('+++'):
                m = re.search(r'\b(?:it|test|describe)(?:\.\w+)?\s*\(\s*["\']([^"\']+)', line)
                if m: introduced.append(f'{f["filename"]}: {m.group(1)}')
    if introduced:
        add('\nAvailable patch-added test/describe declarations (historical; confirm current Appendix F):\n')
        for name in dict.fromkeys(introduced): add('- '+cell(name))

add('\n## Appendix E. Issues: four-day priorities and all historical requirements\n')
ui_issues = {204:'Explicit admin UI report; excluded as requested. Mixed functionality already traced through current source/other issues.',
             232:'Navigation/timeline visual overlap; excluded from non-UI issue extraction. Current controls still get reachability checks.',
             243:'Explicit dropdown UI issue; excluded from historical issue extraction; current MAP13/C controls remain covered.'}
recent = [x for x in issues if START <= x['created_at'] <= END]
add(f'Window: `{START}` through `{END}`, inclusive. **{len(recent)} issues total; {sum(x["number"] not in ui_issues for x in recent)} retained after the three UI exclusions.** Older issues remain below because their functional requirements and issue245 consolidation matter.\n')
add('| Issue | Created UTC | State | Window/scope | Current regression families |')
add('|---|---|---|---|---|')
for issue in sorted(issues, key=lambda x:x['number'], reverse=True):
    n = issue['number']; window = 'FOUR-DAY' if START <= issue['created_at'] <= END else 'older'
    add(f'| [#{n}: {cell(issue["title"])}]({issue["html_url"]}) | {issue["created_at"]} | {issue["state"]} | {window}; {"UI excluded" if n in ui_issues else "retained"} | {issue_family(issue)} |')
for issue in sorted(issues, key=lambda x:(START <= x['created_at'] <= END,x['number']), reverse=True):
    n = issue['number']; window = 'FOUR-DAY' if START <= issue['created_at'] <= END else 'older'
    add(f'\n### Issue{n}: [{cell(issue["title"])}]({issue["html_url"]})\n')
    add(f'Created `{issue["created_at"]}`; state **{issue["state"]}**; {window}. Current regression linkage: {issue_family(issue)}. Closed status is not proof that every deployment/field gate passed.\n')
    if n in ui_issues: add('**Excluded UI history:** '+ui_issues[n]); continue
    add('<details><summary>Recorded issue requirements and historical acceptance claims</summary>\n')
    add(tidy(issue.get('body')) or '(No issue body.)'); add('\n</details>\n')
    comments = read(f'issue-{n}-comments.json')
    if comments:
        add('Discussion/reverification entry points:\n')
        for c in comments:
            if tidy(c.get('body')): add(f'- [{c["created_at"]}]({c["html_url"]}): {cell(c["body"],1000)}')

add('\n## Appendix F. Every statically named existing test/describe entry\n')
add('These are navigation aids into existing regressions, not executed results or 1011 independent test cases. Describe blocks count as named declarations; dynamic table expansion and runtime skips differ. Native firmware registrations are listed separately below. Use actual runner output in a future execution report.\n')
test_count = 0
for f in ledger:
    names = f.get('testNames', [])
    if not names: continue
    add(f'\n### {src(f["path"])} — {domain(f["path"])}\n')
    for t in names:
        test_count += 1
        add(f'- T{test_count:04}: [{cell(t["name"])}]({BASE}{quote(f["path"],safe="/")}#L{t["line"]})')

native_count = 0
add('\n### Native firmware test registrations\n')
for f in ledger:
    if not f['path'].startswith('hardware/test/') or not f['path'].endswith('.cpp'): continue
    text = (DATA / 'files' / f['path']).read_bytes().decode('utf-8').replace('\r\r\n','\n').replace('\r\n','\n')
    for match in re.finditer(r'RUN_TEST\(\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)', text):
        native_count += 1
        line = text[:match.start()].count('\n') + 1
        add(f'- NATIVE{native_count:03}: {src(f["path"],line)} — `{match.group(1)}`; FW / GNSS; registration, not pass.')

add('\n## Appendix G. Inventory totals and explicit remaining work\n')
add(f'- Tracked file rows: **{len(ledger)}**; binary assets: **{sum(f["binary"] for f in ledger)}**.')
add(f'- Production JSX/control occurrences: **{control_count}**; repeated DOM instances and event-only interactions require expansion.')
add(f'- Current HTTP operations: **{api_count}**; each needs H01–H18 and owning domain cases.')
add(f'- Historical PRs: **{len(prs)}**; UI-only exclusions: **{len(ui_prs)}**; retained non-UI/mixed histories: **{len(prs)-len(ui_prs)}**.')
add(f'- Issues: **{len(issues)}**; four-day issues: **{len(recent)}**; four-day retained non-UI/mixed: **{sum(x["number"] not in ui_issues for x in recent)}**.')
add(f'- Statically named test/describe declarations: **{test_count}**; this is not a pass count.')
add(f'- Native firmware RUN_TEST registrations: **{native_count}**; this is not a physical acceptance count.')
add('- Newly supplied GNSS replay helper: planning artifact; no application/network replay executed for this document.')
add('- Required future work: implement missing full-stack/interaction harnesses, provision isolated actors/device mapping, execute and attach evidence, then perform real provider/physical gates. This plan itself does not replace an execution report.\n')

add('\n## Appendix H. Source constants and environment configuration boundaries\n')
add('Values below are source expressions, not observed deployed settings. Expand the value/time matrix around applicable limits and configured overrides. Test missing, malformed, negative, zero and valid values at startup/build time. Do not expose actual secrets in evidence. Constants in test files are excluded from this production/supporting-code inventory. C++ preprocessor/build settings also require FW/REL checks from Appendix A.\n')
add('| Constant | Source | Current expression | Case families |')
add('|---|---|---|---|')
constant_count = 0
envs = {}
for f in ledger:
    if f['binary'] or re.search(r'\.test\.|\.spec\.|/test/',f['path']): continue
    for constant in f.get('constants', []):
        constant_count += 1
        add(f'| `{constant["name"]}` | {src(f["path"],constant["line"])} | {cell(constant["value"])} | {domain(f["path"])} |')
    if f['path'].endswith(('.ts','.tsx','.mjs','.cjs','.js','.yml','.yaml','.example')):
        text = (DATA / 'files' / f['path']).read_bytes().decode('utf-8').replace('\r\r\n','\n').replace('\r\n','\n')
        for match in re.finditer(r'process\.env\.([A-Z][A-Z_0-9]+)|process\.env\[["\']([A-Z][A-Z_0-9]+)["\']\]|^([A-Z][A-Z_0-9]+)=',text,re.M):
            name = next(x for x in match.groups() if x)
            location = (f['path'],text[:match.start()].count('\n')+1)
            envs.setdefault(name,[]).append(location)
add(f'\nProduction/support constant occurrences: **{constant_count}**. Environment variable names detected in executable source/examples: **{len(envs)}** (dynamic/CI secret references may require additional configuration review).\n')
add('| Environment name | Locations | Future checks |')
add('|---|---|---|')
for name, locations in sorted(envs.items()):
    tier = 'Browser build-time public config: ensure no private secret is put in this variable.' if name.startswith('NEXT_PUBLIC_') else 'Server/tooling configuration: supply only in the appropriate isolated process; do not log secret values.'
    add(f'| `{name}` | '+ '; '.join(src(file,line) for file,line in dict.fromkeys(locations))+f' | {tier} Missing/invalid/override/cross-environment consistency. |')

add('\n## Appendix I. Exact HTTP contract details and all schema definitions\n')
add('This section embeds the inspected OpenAPI contract boundaries so a future test writer can build valid/invalid bodies and validate acknowledgements without guessing field names. It is not a claim that descriptions always match handlers. In particular, the creation description says stopped at one endpoint, but current startShift can keep direction pending after a fresh fix when endpoint inference is null; TRIP02 must use the current handler rather than enforce that overstrong description. The read-session summary and older manual-stop prose likewise require source reconciliation. Relative timestamp/ownership/race invariants cannot be represented by JSON Schema alone.\n')
for route,item in openapi['paths'].items():
    for method,op in item.items():
        if method not in ['get','post','put','patch','delete']: continue
        add(f'\n### `{method.upper()} {route}`\n')
        add(tidy(op.get('description')))
        for key in ['x-auth-class','x-body-limit-bytes','x-rate-limit','x-cache-policy','x-timeout-policy','x-retry-policy','x-idempotency']:
            if key in op:add(f'- **{key}:** {cell(op[key]).replace("Ã—","×")}')
        contract = {'parameters':op.get('parameters',[]),'requestBody':op.get('requestBody'),
                    'responses':{status:{'description':response.get('description'),
                                         'schemas':{media:c.get('schema') for media,c in response.get('content',{}).items()},
                                         'headers':response.get('headers',{})}
                                 for status,response in op.get('responses',{}).items()}}
        add('\n<details><summary>Request parameters/body and response/header schemas</summary>\n')
        add('```json\n'+json.dumps(contract,ensure_ascii=False,indent=2)+'\n```\n\n</details>\n')
add(f'\n### All {len(openapi["components"]["schemas"])} referenced schema definitions\n')
for name,schema in openapi['components']['schemas'].items():
    add(f'\n<details><summary>{name}</summary>\n\n```json\n'+json.dumps(schema,ensure_ascii=False,indent=2)+'\n```\n\n</details>\n')

add('\n## Appendix J. Complete companion GNSS generator source\n')
helper = (ROOT/'docs/testing/simulations/generate-gnss.mjs').read_bytes()
add('The standalone file and this embedded copy are the same planning artifact. Syntax was checked; no application replay or acceptance test was performed. Default mode is offline. Sending requires explicit loopback/disposable flags and a private environment credential. See Section 6 for setup, limitations and profiles.\n')
add('Helper SHA256: `'+hashlib.sha256(helper).hexdigest()+'`.\n')
add('<details><summary>Copyable Node.js helper</summary>\n\n```js\n'+helper.decode('utf-8').rstrip()+'\n```\n\n</details>\n')
original = PLAN.read_text(encoding='utf-8').split('<!-- GENERATED_APPENDICES_START -->')[0]
PLAN.write_text(original + '<!-- GENERATED_APPENDICES_START -->\n\n' + '\n'.join(out) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({'files':len(ledger),'controls':control_count,'operations':api_count,'declaredTests':test_count,'prs':len(prs),'issues':len(issues),'bytes':PLAN.stat().st_size}))
