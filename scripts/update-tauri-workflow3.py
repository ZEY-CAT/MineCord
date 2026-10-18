with open('.github/workflows/tauri-build.yml', 'r', encoding='utf-8-sig') as f:
    lines = f.readlines()

new_lines = []
i = 0
while i < len(lines):
    line = lines[i]
    # Check if this is the start of the Package Tauri Lite Edition ZIP step
    if 'Package Tauri Lite Edition ZIP' in line and 'run: |' in lines[i+1] if i+1 < len(lines) else False:
        # Add the new step
        new_lines.append('      - name: Package Tauri Lite Edition ZIP\n')
        new_lines.append('        run: powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\\package-tauri-zip.ps1 -Version "${{ github.event.inputs.version || \'1.0.2\' }}"\n')
        # Skip the old inline script until we find "shell: pwsh"
        i += 1
        while i < len(lines):
            if 'shell: pwsh' in lines[i]:
                i += 1  # skip the shell: pwsh line
                break
            i += 1
        continue
    new_lines.append(line)
    i += 1

# Write back
with open('.github/workflows/tauri-build.yml', 'w', encoding='utf-8') as f:
    f.writelines(lines)

print("Updated tauri-build.yml")