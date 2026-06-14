import json
import sys

target_file = sys.argv[1]
new_translations_file = sys.argv[2]

with open(target_file, encoding='utf-8') as f:
    target = json.load(f)

with open(new_translations_file, encoding='utf-8') as f:
    new_translations = json.load(f)


def deep_merge(base, updates):
    result = dict(base)
    for k, v in updates.items():
        if k in result and isinstance(result[k], dict) and isinstance(v, dict):
            result[k] = deep_merge(result[k], v)
        else:
            result[k] = v
    return result


merged = deep_merge(target, new_translations)

with open(target_file, 'w', encoding='utf-8') as f:
    json.dump(merged, f, ensure_ascii=False, indent=2)
    f.write('\n')

print(f'✓ Merged translations into {target_file}')
