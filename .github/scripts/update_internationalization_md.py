import re

# Language metadata: code -> (flag, native name, English name)
LANG_META = {
    'en': ('us', 'English',  'English'),
    'de': ('de', 'Deutsch',  'German'),
    'es': ('es', 'Español',  'Spanish'),
    'fr': ('fr', 'Français', 'French'),
    'it': ('it', 'Italiano', 'Italian'),
    'ja': ('jp', '日本語',   'Japanese'),
    'pt': ('pt', 'Português','Portuguese'),
    'ro': ('ro', 'Română',   'Romanian'),
    'ru': ('ru', 'Русский',  'Russian'),
    'sk': ('sk', 'Slovenský','Slovak'),
    'sv': ('se', 'Svenska',  'Swedish'),
    'tr': ('tr', 'Türkçe',   'Turkish'),
    'zh': ('cn', '中文',     'Chinese (Simplified)'),
}

FLAG_EMOJI = {
    'us': '🇺🇸', 'de': '🇩🇪', 'es': '🇪🇸', 'fr': '🇫🇷',
    'it': '🇮🇹', 'jp': '🇯🇵', 'pt': '🇵🇹', 'ro': '🇷🇴',
    'ru': '🇷🇺', 'sk': '🇸🇰', 'se': '🇸🇪', 'tr': '🇹🇷',
    'cn': '🇨🇳',
}

# Read language.model.ts to get the list of supported languages
with open('main/http_server/axe-os/src/app/@i18n/models/language.model.ts', encoding='utf-8') as f:
    model = f.read()

codes = re.findall(r"'([a-z]{2})'", model)
if 'en' in codes:
    codes.remove('en')
codes = ['en'] + sorted(codes)

print(f'Detected language codes: {codes}')

# Build supported languages list
lang_list_lines = []
for code in codes:
    meta = LANG_META.get(code, (code, code, code))
    flag_code, native, english = meta
    emoji = FLAG_EMOJI.get(flag_code, '🌐')
    if code == 'en':
        lang_list_lines.append(f'- {emoji} **{english} ({code})** - Default language')
    else:
        lang_list_lines.append(f'- {emoji} **{english} ({code})**')
lang_list = '\n'.join(lang_list_lines)

# Build file structure list
file_struct_lines = ['```', 'src/assets/i18n/']
for code in codes:
    meta = LANG_META.get(code, (code, code, code))
    _, _, english = meta
    if code == 'en':
        file_struct_lines.append(f'├── {code}.json    # {english} (reference)')
    elif code == codes[-1]:
        file_struct_lines.append(f'└── {code}.json    # {english}')
    else:
        file_struct_lines.append(f'├── {code}.json    # {english}')
file_struct_lines.append('```')
file_struct = '\n'.join(file_struct_lines)

# Build addLangs line
langs_array = ', '.join(f"'{c}'" for c in codes)
add_langs = f"translate.addLangs([{langs_array}]);"

# Build language.model.ts type line
type_line = "export type Language = " + ' | '.join(f"'{c}'" for c in codes) + ";"

# Build nb-option entries for selector example
nb_options = []
for code in codes:
    meta = LANG_META.get(code, (code, code, code))
    flag_code, native, _ = meta
    nb_options.append(
        f'<nb-option value="{code}">\n'
        f'  <span class="flag-icon flag-icon-{flag_code}"></span>\n'
        f'  {native}\n'
        f'</nb-option>'
    )
nb_options_str = '\n'.join(nb_options)

# Read the MD file
md_path = 'main/http_server/axe-os/INTERNATIONALIZATION.md'
with open(md_path, encoding='utf-8') as f:
    content = f.read()

# Replace supported languages section
content = re.sub(
    r'(### Supported Languages\n\n).*?(\n\n## File Structure)',
    lambda m: m.group(1) + lang_list + m.group(2),
    content,
    flags=re.DOTALL
)

# Replace file structure block
content = re.sub(
    r'(## File Structure\n\n)```.*?```',
    lambda m: m.group(1) + file_struct,
    content,
    flags=re.DOTALL
)

# Replace addLangs line in Adding a New Language section
content = re.sub(
    r'translate\.addLangs\(\[.*?\]\);',
    add_langs,
    content
)

# Replace language.model.ts type line in Adding a New Language section
content = re.sub(
    r"export type Language = .*?;",
    type_line,
    content
)

with open(md_path, 'w', encoding='utf-8') as f:
    f.write(content)

print(f'✓ Updated {md_path}')
