with open('.github/workflows/tauri-build.yml', 'r', encoding='utf-8-sig') as f:
    content = f.read()

# Find and replace the block using a more robust approach
# Find the start of the block
start_marker = '      - name: Package Tauri Lite Edition ZIP\n        run: |'
end_marker = '        shell: pwsh'

start_idx = content.find(start_marker)
if start_idx == -1:
    print("Start marker not found!")
    # Try to find with slight variations
    if 'Package Tauri Lite Edition ZIP' in content:
        print("Found 'Package Tauri Lite Edition ZIP'")
    else:
        print("Not found at all")
else:
    end_idx = content.find(end_marker, start_idx)
    if end_idx == -1:
        print("End marker not found!")
    else:
        # Include the end marker line
        end_idx += len(end_marker)
        print(f"Found block from {start_idx} to {end_idx}")
        # Replace
        new_block = '''      - name: Package Tauri Lite Edition ZIP
        run: powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\\package-tauri-zip.ps1 -Version "${{ github.event.inputs.version || '1.0.2' }}"
'''
        new_content = content[:start_idx] + new_block + content[end_idx:]
        with open('.github/workflows/tauri-build.yml', 'w', encoding='utf-8') as f:
            f.write(new_content)
        print("Updated tauri-build.yml")