# Regression tests

Run from the repository root with PowerShell 7.2 or later:

```powershell
pwsh -NoProfile -File .\neo-full-url-address-bar\tests\Run-RegressionTests.ps1
pwsh -NoProfile -File .\neo-full-url-address-bar\tests\Run-PathDiscoveryTests.ps1
pwsh -NoProfile -File .\neo-full-url-address-bar\tests\Run-RuntimeTests.ps1
```

Pester and an installed Neo browser are not required. Tests extract functions
with the PowerShell parser, and write only inside a unique temporary fixture
directory. The browser process query returns empty or simulated fixture results;
the fake `neo.exe` file is never executed. Process launch and termination are
blocked. Shortcut COM calls use in-memory objects; only dedicated temporary-link
tests allow Save, which writes an inert placeholder within that fixture root.
The whole-installer preview uses
explicit temporary executable, profile, extension and maintenance directories,
and skips real shortcuts, URL handlers and browser auto-start commands.

Coverage includes preserved user arguments, repeated Chromium switches,
idempotence, extension paths containing spaces, the `--single-argument` URL
boundary, stale Neo executable paths, Undo, multiple profiles, account-level
extension pins, JSON number and string preservation, and a file snapshot check
that `-WhatIf` writes nothing. Managed-shortcut tests exercise creation,
idempotence, automatic-repair removal, unrelated ownership protection and paths
containing brackets. Maintenance always skips Preferences, including when no
browser process is present; normal installation stops before writing if its
profile is running. Whole-script Undo fixtures cover saved custom directories
after a portable browser is removed, and removal from an installed runtime where
the extension source and deployed directory coincide. Both preserve unrelated
user files. A failing test returns exit code 1.

The discovery suite simulates separate devices, registry priority and updates
with a removed old executable. The runtime suite copies the real launcher to
a temporary deployment with recording-only discovery/installer substitutes;
process launches are intercepted. It checks sign-in repair, launch arguments,
explicit choices, automatic fallback and URL preservation/rejection.
