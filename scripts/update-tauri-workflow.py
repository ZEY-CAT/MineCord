with open('.github/workflows/tauri-build.yml', 'r', encoding='utf-8-sig') as f:
    lines = f.readlines()

new_lines = []
i = 0
while i < len(lines):
    line = lines[i]
    if 'Package Tauri Lite Edition ZIP' in line and i+1 < len(lines) and 'run: |' in lines[i+1]:
        # Found the start of the block to replace
        # Add the new step
        new_lines.append('      - name: Package Tauri Lite Edition ZIP\n')
        new_lines.append('        run: powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\\package-tauri-zip.ps1 -Version "${{ github.event.inputs.version || \'1.0.2\' }}"\n')
        # Skip lines until we find the next step (starts with "- name:" or is at the same indentation level as a new step)
        i += 1
        while i < len(lines):
            line = lines[i]
            # Stop when we find a new step at the same indentation level (6 spaces + "- name:")
            if line.strip().startswith('- name:') and not line.startswith('        '):
                break
            # Also stop if we hit a line that's not indented (top-level)
            if line.strip() and not line.startswith(' ') and not line.startswith('\t'):
                break
            i += 1
        continue
    new_lines.append(line)
    i += 1

# Write back
with open('.github/workflows/tauri-build.yml', 'w', encoding='utf-8') as f:
    f.writelines(lines)

print("Updated tauri-build.yml")