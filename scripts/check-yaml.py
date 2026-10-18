with open('.github/workflows/updater-dll-build.yml', 'r', encoding='utf-8-sig') as f:
    content = f.read()

lines = content.split('\n')
for i, line in enumerate(lines):
    if '\t' in line:
        print(f'Line {i+1}: Contains tab character')
    if line.rstrip() != line:
        print(f'Line {i+1}: Trailing whitespace')
    if '@"' in line:
        print(f'Line {i+1}: Contains @" - potential here-string issue: {line.strip()[:80]}')
    if '"@' in line:
        print(f'Line {i+1}: Contains "@ - potential here-string issue: {line.strip()[:80]}')