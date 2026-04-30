import re
import os
import json
import urllib.request

# Read language.model.ts to get the list of supported languages
with open('main/http_server/axe-os/src/app/@i18n/models/language.model.ts', encoding='utf-8') as f:
    model = f.read()

# Extract language codes from the type definition
codes = re.findall(r"'([a-z]{2})'", model)

# Always put 'en' first, then sort the rest
if 'en' in codes:
    codes.remove('en')
codes = ['en'] + sorted(codes)

print(f'Detected language codes: {codes}')

# Ask Claude to return native language names and flag icon codes for each code
api_key = os.environ['ANTHROPIC_API_KEY']
prompt = (
    f'Return a JSON object mapping each of these ISO 639-1 language codes to an object with two fields: '
    f'"label" (the native name of the language written in that language itself) and '
    f'"flag" (the ISO 3166-1 alpha-2 country code for the most commonly associated country, lowercase). '
    f'Codes: {json.dumps(codes)}. '
    f'Example format: {{"en": {{"label": "English", "flag": "us"}}, "de": {{"label": "Deutsch", "flag": "de"}}, "zh": {{"label": "中文", "flag": "cn"}}}}. '
    f'Return only valid JSON, no markdown, no explanation.'
)

payload = json.dumps({
    'model': 'claude-sonnet-4-5',
    'max_tokens': 512,
    'messages': [{'role': 'user', 'content': prompt}]
}).encode('utf-8')

req = urllib.request.Request(
    'https://api.anthropic.com/v1/messages',
    data=payload,
    headers={
        'x-api-key': api_key,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
    }
)

with urllib.request.urlopen(req) as resp:
    data = json.loads(resp.read())

raw = data['content'][0]['text'].strip()
raw = re.sub(r'^```json\s*', '', raw)
raw = re.sub(r'^```\s*', '', raw)
raw = re.sub(r'```\s*$', '', raw)

lang_data = json.loads(raw)
print(f'Language data: {lang_data}')

# Build the nb-option entries
options = []
for code in codes:
    info = lang_data.get(code, {'label': code, 'flag': code})
    label = info.get('label', code)
    flag = info.get('flag', code)
    options.append(
        f'    <nb-option value="{code}">\n'
        f'      <span class="flag-icon flag-icon-{flag}"></span>\n'
        f'      {label}\n'
        f'    </nb-option>'
    )

options_html = '\n'.join(options)

content = f"""<div class="language-selector">
  <nb-select
    [placeholder]="'LANGUAGE.SELECTOR' | translate"
    [selected]="currentLanguage$ | async"
    (selectedChange)="setLanguage($event)"
    shape="semi-round"
    size="small">
{options_html}
  </nb-select>
</div>
"""

output_path = 'main/http_server/axe-os/src/app/@i18n/container/language-selector/language-selector.component.html'
with open(output_path, 'w', encoding='utf-8') as f:
    f.write(content)

print(f'✓ Updated {output_path}')
