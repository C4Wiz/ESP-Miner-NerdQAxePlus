import re

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

# Build the addLangs array string
langs_array = ', '.join(f"'{c}'" for c in codes)
add_langs_line = f"    translate.addLangs([{langs_array}]);"

# Read and update app.component.ts
app_path = 'main/http_server/axe-os/src/app/app.component.ts'
with open(app_path, encoding='utf-8') as f:
    content = f.read()

# Replace the addLangs line regardless of what's currently in it
updated = re.sub(
    r"    translate\.addLangs\([^)]*\);",
    add_langs_line,
    content
)

if updated == content:
    print('WARNING: addLangs line not found in app.component.ts — no changes made')
else:
    with open(app_path, 'w', encoding='utf-8') as f:
        f.write(updated)
    print(f'✓ Updated {app_path}')
