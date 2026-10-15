# Neo executable discovery shared by the installer and its maintenance launcher.
# Dot-sourcing this file only defines functions; discovery never changes the system.

function Get-NeoCommandParts {
    [CmdletBinding()]
    param([AllowNull()][AllowEmptyString()][string]$CommandLine)

    if ([string]::IsNullOrWhiteSpace($CommandLine)) { return }
    $value = $CommandLine.Trim()
    # Unquoted Windows registrations sometimes contain spaces in the executable
    # path. Stop at neo.exe, rather than splitting on the first space.
    $match = [regex]::Match($value, '^(?:"(?<path>[^"]+)"|''(?<path>[^'']+)''|(?<path>.*?[\\/]neo\.exe|neo\.exe|%[^%]+%))(?=\s|,|$)', 'IgnoreCase')
    if (-not $match.Success) { return }
    $path = [Environment]::ExpandEnvironmentVariables($match.Groups['path'].Value)
    if ([IO.Path]::GetFileName($path) -ine 'neo.exe') { return }
    [pscustomobject]@{ Path = $path; Arguments = $value.Substring($match.Length).TrimStart() }
}

function ConvertFrom-NeoExecutableCommand {
    [CmdletBinding()]
    param([AllowNull()][AllowEmptyString()][string]$Command)

    $parts = Get-NeoCommandParts $Command
    if ($parts) { $parts.Path }
}

function ConvertTo-NeoExecutablePath {
    [CmdletBinding()]
    param([AllowNull()][AllowEmptyString()][string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) { return }
    try {
        $value = [Environment]::ExpandEnvironmentVariables($Path.Trim().Trim('"').Trim("'"))
        if ([IO.Path]::GetFileName($value) -ine 'neo.exe') { return }
        [IO.Path]::GetFullPath($value)
    } catch { return }
}

function Select-NeoExecutableCandidate {
    [CmdletBinding()]
    param(
        [AllowEmptyCollection()][object[]]$Candidates,
        [scriptblock]$PathExists = { param($Path) Test-Path -LiteralPath $Path -PathType Leaf }
    )

    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    # Candidates have Path, Source and Priority; strings are accepted as well.
    # Stable sorting retains discovery order among equally ranked registrations.
    foreach ($candidate in @($Candidates | Where-Object { $null -ne $_ } | Sort-Object -Stable -Property {
        if ($_ -is [string]) { 100 } else { $_.Priority }
    })) {
        $rawPath = if ($candidate -is [string]) { $candidate } else { $candidate.Path }
        $path = ConvertTo-NeoExecutablePath $rawPath
        if (-not $path -or -not $seen.Add($path)) { continue }
        if (& $PathExists $path) { return $path }
    }
}

function Get-NeoDefaultShortcutRoots {
    $roots = [Collections.Generic.List[string]]::new()
    if ($env:APPDATA) {
        $roots.Add((Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu'))
        $roots.Add((Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch'))
    }
    $desktop = [Environment]::GetFolderPath('Desktop')
    if ($desktop) { $roots.Add($desktop) }
    if ($env:ProgramData) { $roots.Add((Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu')) }
    if ($env:PUBLIC) { $roots.Add((Join-Path $env:PUBLIC 'Desktop')) }
    $roots.ToArray()
}

function Get-NeoRunningExecutableCandidates {
    if (-not [OperatingSystem]::IsWindows()) { return }
    try {
        $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        foreach ($process in @(Get-CimInstance Win32_Process -Filter "Name='neo.exe'" -ErrorAction Stop)) {
            if (-not $process.ExecutablePath) { continue }
            try {
                # Read-only query: it must still run during an installer -WhatIf preview.
                $owner = Invoke-CimMethod -InputObject $process -MethodName GetOwnerSid -ErrorAction Stop -WhatIf:$false -Confirm:$false
                if ($owner.ReturnValue -ne 0 -or $owner.Sid -ne $currentSid) { continue }
                [pscustomobject]@{ Path = $process.ExecutablePath; Source = 'CurrentUserProcess'; Priority = 10 }
            } catch {
                # Ownership must be established; never use another user's Neo.
                Write-Verbose "Cannot inspect Neo process $($process.ProcessId): $_"
            }
        }
    } catch { Write-Verbose "Cannot enumerate current user's Neo processes: $_" }
}

function Select-NeoProgIdNames {
    [CmdletBinding()]
    param([AllowEmptyCollection()][string[]]$Names, [string[]]$ProgIds = @('NeoHTM', 'NeoPDF'))

    # Per-user installs register suffixed ProgIds such as NeoHTM.<install id>,
    # so each base name matches itself and its dotted forms.
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($progId in @($ProgIds | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })) {
        foreach ($name in @($Names | Where-Object { $_ })) {
            if (($name -ieq $progId -or $name.StartsWith("$progId.", [StringComparison]::OrdinalIgnoreCase)) -and $seen.Add($name)) { $name }
        }
    }
}

function Get-NeoProgIdNames {
    [CmdletBinding()]
    param([string[]]$ProgIds = @('NeoHTM', 'NeoPDF'))

    if (-not [OperatingSystem]::IsWindows()) { return $ProgIds }
    $names = [Collections.Generic.List[string]]::new()
    foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryHive]::LocalMachine)) {
        foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
            $base = $null
            $classes = $null
            try {
                $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
                $classes = $base.OpenSubKey('Software\Classes')
                if ($classes) { $names.AddRange([string[]]@(Select-NeoProgIdNames $classes.GetSubKeyNames() $ProgIds)) }
            } catch { Write-Verbose "Cannot list Neo ProgIds in $hive/$view`: $_" }
            finally {
                if ($classes) { $classes.Dispose() }
                if ($base) { $base.Dispose() }
            }
        }
    }
    # A base name without registrations stays listed, so callers can report it as skipped.
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($progId in @($ProgIds | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })) {
        $found = @(Select-NeoProgIdNames $names $progId)
        foreach ($name in $(if ($found.Count) { $found } else { $progId })) { if ($seen.Add($name)) { $name } }
    }
}

function Get-NeoRegisteredExecutableCandidates {
    [CmdletBinding()]
    param([string[]]$ProgIds = @('NeoHTM', 'NeoPDF'))

    if (-not [OperatingSystem]::IsWindows()) { return }
    $ProgIds = @(Get-NeoProgIdNames -ProgIds $ProgIds)
    foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryHive]::LocalMachine)) {
        foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
            $base = $null
            try {
                $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
                $key = $base.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\App Paths\neo.exe')
                if ($key) {
                    try {
                        $path = ConvertFrom-NeoExecutableCommand ([string]$key.GetValue(''))
                        if ($path) { [pscustomobject]@{ Path = $path; Source = "$hive/$view/AppPaths"; Priority = 20 } }
                    } finally { $key.Dispose() }
                }

                $browsers = $base.OpenSubKey('Software\Clients\StartMenuInternet')
                if ($browsers) {
                    try {
                        foreach ($name in $browsers.GetSubKeyNames()) {
                            $commandKey = $browsers.OpenSubKey("$name\shell\open\command")
                            if (-not $commandKey) { continue }
                            try {
                                $path = ConvertFrom-NeoExecutableCommand ([string]$commandKey.GetValue(''))
                                if ($path) { [pscustomobject]@{ Path = $path; Source = "$hive/$view/StartMenuInternet/$name"; Priority = 30 } }
                            } finally { $commandKey.Dispose() }
                        }
                    } finally { $browsers.Dispose() }
                }

                foreach ($progId in $ProgIds) {
                    if ([string]::IsNullOrWhiteSpace($progId)) { continue }
                    $classKey = $base.OpenSubKey("Software\Classes\$progId")
                    if (-not $classKey) { continue }
                    try {
                        # Earlier script versions create HKCU shadows pointing at
                        # the then-current install. Rank these after all other
                        # sources so an updater's real registration wins.
                        $isShadow = $hive -eq [Microsoft.Win32.RegistryHive]::CurrentUser -and
                            $null -ne $classKey.GetValue('NeoFullUrlAddressBar')
                        $priority = if ($isShadow) { 80 } else { 40 }
                        $commandKey = $classKey.OpenSubKey('shell\open\command')
                        if (-not $commandKey) { continue }
                        try {
                            $path = ConvertFrom-NeoExecutableCommand ([string]$commandKey.GetValue(''))
                            if ($path) { [pscustomobject]@{ Path = $path; Source = "$hive/$view/ProgId/$progId"; Priority = $priority } }
                        } finally { $commandKey.Dispose() }
                    } finally { $classKey.Dispose() }
                }
            } catch { Write-Verbose "Cannot inspect Neo registration in $hive/$view`: $_" }
            finally { if ($base) { $base.Dispose() } }
        }
    }
}

function Get-NeoShortcutExecutableCandidates {
    [CmdletBinding()]
    param([string[]]$ShortcutRoots)

    if (-not [OperatingSystem]::IsWindows()) { return }
    if ($null -eq $ShortcutRoots) { $ShortcutRoots = @(Get-NeoDefaultShortcutRoots) }
    $shell = $null
    try {
        $shell = New-Object -ComObject WScript.Shell -ErrorAction Stop
        $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
        foreach ($root in $ShortcutRoots) {
            if (-not $root -or -not (Test-Path -LiteralPath $root -PathType Container)) { continue }
            foreach ($item in @(Get-ChildItem -LiteralPath $root -Filter '*.lnk' -Recurse -File -ErrorAction SilentlyContinue)) {
                if (-not $seen.Add($item.FullName)) { continue }
                $shortcut = $null
                try {
                    $shortcut = $shell.CreateShortcut($item.FullName)
                    $path = ConvertTo-NeoExecutablePath $shortcut.TargetPath
                    if ($path) { [pscustomobject]@{ Path = $path; Source = "Shortcut/$($item.FullName)"; Priority = 50 } }
                } catch { Write-Verbose "Cannot read shortcut $($item.FullName): $_" }
                finally {
                    if ($shortcut -and [Runtime.InteropServices.Marshal]::IsComObject($shortcut)) {
                        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shortcut)
                    }
                }
            }
        }
    } catch { Write-Verbose "Cannot inspect Neo shortcuts: $_" }
    finally {
        if ($shell -and [Runtime.InteropServices.Marshal]::IsComObject($shell)) {
            [void][Runtime.InteropServices.Marshal]::ReleaseComObject($shell)
        }
    }
}

function Get-NeoCommonExecutableCandidates {
    # Only probe fixed well-known paths. Do not walk drives or user profiles.
    $bases = @($env:LOCALAPPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:ProgramW6432) |
        Where-Object { $_ } | Select-Object -Unique
    foreach ($base in $bases) {
        foreach ($relative in @('Neo\Application\neo.exe', 'Neo\neo.exe', 'Programs\Neo\Application\neo.exe', 'Programs\Neo\neo.exe')) {
            [pscustomobject]@{ Path = (Join-Path $base $relative); Source = 'CommonInstallPath'; Priority = 60 }
        }
    }
    foreach ($command in @(Get-Command neo.exe -CommandType Application -All -ErrorAction SilentlyContinue)) {
        [pscustomobject]@{ Path = $command.Source; Source = 'PATH'; Priority = 70 }
    }
}

function Resolve-NeoExecutable {
    [CmdletBinding()]
    param(
        [AllowNull()][AllowEmptyString()][string]$ExplicitPath,
        [AllowNull()][AllowEmptyCollection()][string[]]$ShortcutRoots,
        [string[]]$ProgIds = @('NeoHTM', 'NeoPDF'),
        [AllowNull()][AllowEmptyString()][string]$HintPath
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitPath)) {
        $path = ConvertTo-NeoExecutablePath $ExplicitPath
        if (-not $path -or -not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "指定的 Neo 程序不存在或不是 neo.exe：$ExplicitPath。请用 -NeoExe 指定此设备上实际的 neo.exe 路径。"
        }
        return $path
    }

    $path = Select-NeoExecutableCandidate @(Get-NeoRunningExecutableCandidates)
    if ($path) { return $path }

    $registered = @(Get-NeoRegisteredExecutableCandidates -ProgIds $ProgIds)
    $path = Select-NeoExecutableCandidate @($registered | Where-Object { $_.Priority -lt 80 })
    if ($path) { return $path }

    $path = Select-NeoExecutableCandidate @(Get-NeoShortcutExecutableCandidates -ShortcutRoots $ShortcutRoots)
    if ($path) { return $path }

    $path = Select-NeoExecutableCandidate @(Get-NeoCommonExecutableCandidates)
    if ($path) { return $path }

    $path = Select-NeoExecutableCandidate @($registered | Where-Object { $_.Priority -ge 80 })
    if ($path) { return $path }

    # Saved portable/custom paths are only hints: current process and real
    # browser registrations must win after an update or reinstall.
    $path = Select-NeoExecutableCandidate @($HintPath)
    if ($path) { return $path }
    throw '未找到 Neo 的 neo.exe。已检查当前用户进程、浏览器注册、快捷方式、常见安装目录及 PATH。请先安装或打开一次 Neo，或用 -NeoExe 指定实际路径。'
}
