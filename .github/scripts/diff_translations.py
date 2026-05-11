import json
import sys

en_file = sys.argv[1]
target_file = sys.argv[2]
prev_en_file = sys.argv[3] if len(sys.argv) > 3 else None

with open(en_file, encoding='utf-8') as f:
    en = json.load(f)

with open(target_file, encoding='utf-8') as f:
    target = json.load(f)

prev_en = None
if prev_en_file:
    try:
        with open(prev_en_file, encoding='utf-8') as f:
            prev_en = json.load(f)
    except FileNotFoundError:
        prev_en = None


def flatten(obj, prefix=''):
    items = {}
    for k, v in obj.items():
        key = f"{prefix}.{k}" if prefix else k
        if isinstance(v, dict):
            items.update(flatten(v, key))
        else:
            items[key] = v
    return items


def unflatten(flat):
    result = {}
    for key, value in flat.items():
        parts = key.split('.')
        d = result
        for part in parts[:-1]:
            d = d.setdefault(part, {})
        d[parts[-1]] = value
    return result


en_flat = flatten(en)
target_flat = flatten(target)
prev_flat = flatten(prev_en) if prev_en else {}

changed = {}
for k, v in en_flat.items():
    # Key missing from target
    if k not in target_flat:
        changed[k] = v
        continue
    # Key value changed in en.json since last run
    if prev_flat and k in prev_flat and prev_flat[k] != v:
        changed[k] = v

# Output as nested JSON matching en.json structure
print(json.dumps(unflatten(changed), ensure_ascii=False, indent=2))
