# Windows UTF-8 encoding

This project stores all source as **UTF-8**. On this machine the interactive console defaulted to **code page 936 (GBK)**, which corrupted Chinese when agents used PowerShell/`Set-Content`.

## Already configured in-repo

| File | Effect |
|------|--------|
| `.editorconfig` | Editors use `charset = utf-8` |
| `.gitattributes` | Source checked out as UTF-8 |
| `.vscode/settings.json` | Workspace UTF-8; **Command Prompt** default; `chcp 65001` on start |
| `.cursor/rules/utf8-encoding.mdc` | Agents must write Chinese via UTF-8-safe paths |
| Cursor User `settings.json` | Same terminal/UTF-8 defaults globally |

Environment for integrated terminals:

- `PYTHONUTF8=1`
- `PYTHONIOENCODING=utf-8`

## Prefer cmd

In Cursor: Terminal default profile is **Command Prompt**.

Manual check:

```bat
chcp
REM expect: Active code page: 65001
```

If you must use PowerShell once:

```powershell
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$OutputEncoding = [Console]::OutputEncoding
```

## Enable Windows system-wide UTF-8 (recommended)

Without this, some Win32 APIs still use ACP 936.

1. Open **Settings → Time & language → Language & region → Administrative language settings**
   (or run `intl.cpl` → **Administrative**).
2. **Change system locale…**
3. Check **Beta: Use Unicode UTF-8 for worldwide language support**.
4. Reboot.

After reboot, new `cmd` sessions should report `65001` even without `chcp`.

## Safe write recipes for agents / scripts

```bat
REM Good: Python writes UTF-8 bytes explicitly
python -c "from pathlib import Path; Path(r'src\pages\X.tsx').write_text(content, encoding='utf-8')"
```

```bat
REM Bad: PowerShell Set-Content without -Encoding utf8 (uses system ANSI)
```

Verify:

```bat
python -c "p=open(r'src\pages\Habits.tsx',encoding='utf-8').read(); assert '\u4e60\u60ef' in p; print('utf8 ok')"
```

## Optional local git (do not require force-push)

If `git log` / status shows escaped Chinese, you may set **for this user**:

```bat
git config --global core.quotepath false
git config --global i18n.commitEncoding utf-8
git config --global i18n.logOutputEncoding utf-8
```

(Project policy: agents should not change git config unless you ask.)
