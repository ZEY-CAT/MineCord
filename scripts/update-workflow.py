import re

# Read the workflow file
with open('.github/workflows/updater-dll-build.yml', 'r', encoding='utf-8') as f:
    lines = f.readlines()

# Find the line with "Package Electron Full Edition ZIP" and replace the run block
new_lines = []
i = 0
while i < len(lines):
    line = lines[i]
    if 'Package Electron Full Edition ZIP' in line and 'run:' in lines[i+1] and '|' in lines[i+1]:
        # Found the start of the block to replace
        # Skip until we find "shell: pwsh"
        new_lines.append('  - name: Package Electron Full Edition ZIP\n')
        new_lines.append('        run: powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\\package-electron-zip.ps1 -Version "${{ github.event.inputs.version || \'1.0.2\' }}"\n')
        # Skip lines until we find "shell: pwsh"
        while i < len(lines) and 'shell: pwsh' not in lines[i]:
            i += 1
        if i < len(lines):
            i += 1  # skip the "shell: pwsh" line
        continue
    new_lines.append(line)
    i += 1

# Write back
with open('.github/workflows/updater-dll-build.yml', 'w', encoding='utf-8') as f:
    f.writelines(new_lines)

print("Updated workflow file")