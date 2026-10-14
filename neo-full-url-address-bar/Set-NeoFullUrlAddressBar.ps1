#Requires -Version 7.2
<#
.SYNOPSIS
    Neo 浏览器工具栏调整：地址栏始终显示完整 URL 并占满宽度，移除垂直选项卡按钮，新增页面缩放按钮。

.DESCRIPTION
    Neo's toolbar is browser UI (the address bar is a <readonly-omnibox> WebUI
    element on a chrome:// surface), not part of any web page, so userscript
    managers such as Tampermonkey cannot reach it. This script applies the
    browser-level settings that do work:

    1. Launch switches. Neo only reads them when its browser process starts, so
       they are added to every entry point that can cold-start Neo:
         - shortcuts that target neo.exe or chrome_proxy.exe (Start menu, taskbar
           pins, desktop, and the installed web app shortcuts under "Neo 应用");
         - every registry command that launches Neo (NeoHTM / NeoPDF for links
           and files, the neo: protocol, ...). Machine-wide ones get a per-user
           override under HKCU\Software\Classes, so no admin rights are needed.
         --disable-features=NavigatorReadOnlyOmnibox
             Falls back to the standard Chromium omnibox, which honours "always
             show full URLs" instead of showing the domain only.
         --disable-features=NeoVerticalTabs
             Removes the vertical tabs toggle at the left end of the toolbar
             (vertical tabs become unavailable; smart tab grouping keeps working).
         --load-extension=<ExtensionDir>
             Loads the bundled zoom-controls extension: a toolbar button whose
             badge shows the zoom level and whose popup has zoom out / level
             (click to reset) / zoom in.
    2. Profile preferences:
         omnibox.prevent_url_elisions     = true   full URL including https://
         navigator.omnibox.use_full_width = true   "Use full address bar width"
         navigator.omnibox.show_title     = false  never replace the URL with the page title
         extensions.pinned_extensions     += the zoom extension, placed next to the address bar
    3. Copies zoom-controls\ to ExtensionDir, so the extension keeps working if
       this repository is moved or deleted.
    4. Logon repair: copies this script to %LOCALAPPDATA%\NeoToolbarTweaks and
       adds a hidden HKCU Run entry that re-applies the switches at every Windows
       logon, because Neo updates and newly installed web apps recreate shortcuts
       without them. With -LaunchAtLogon it also opens Neo with the switches, so
       even launches the script cannot patch (notification clicks, jump lists,
       other programs) join a correctly configured browser process.

    Neo must be fully closed while the script runs. -Undo reverts everything and
    -WhatIf previews the changes without writing anything.

.EXAMPLE
    pwsh -File .\Set-NeoFullUrlAddressBar.ps1 -WhatIf
.EXAMPLE
    pwsh -File .\Set-NeoFullUrlAddressBar.ps1
.EXAMPLE
    pwsh -File .\Set-NeoFullUrlAddressBar.ps1 -LaunchAtLogon
.EXAMPLE
    pwsh -File .\Set-NeoFullUrlAddressBar.ps1 -KeepVerticalTabsButton -NoZoomControls
.EXAMPLE
    pwsh -File .\Set-NeoFullUrlAddressBar.ps1 -Undo
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$Undo,
    [switch]$KeepVerticalTabsButton,
    [switch]$NoZoomControls,
    [switch]$LaunchAtLogon,
    [switch]$NoLogonRepair,
    # Used by the Run entry: re-patch launch entry points quietly, logging to a file.
    [switch]$LogonRepair,
    [string]$UserDataDir = (Join-Path $env:LOCALAPPDATA 'Neo\User Data'),
    [string]$NeoExe = (Join-Path $env:ProgramFiles 'Neo\Application\neo.exe'),
    [string]$ExtensionDir = (Join-Path $env:LOCALAPPDATA 'NeoToolbarTweaks\zoom-controls'),
    [string[]]$ShortcutRoots = @(
        (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu'),
        (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch'),
        [Environment]::GetFolderPath('Desktop'),
        (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu'),
        (Join-Path $env:PUBLIC 'Desktop')
    ),
    # Registry ProgIds / protocols to patch. Default: every one whose command launches Neo.
    [string[]]$ProgIds,
    [switch]$SkipPreferences,
    [switch]$SkipShortcuts,
    [switch]$SkipUrlHandlers
)

$ErrorActionPreference = 'Stop'
$ScriptParameters = $PSBoundParameters

# Set on HKCU ProgId keys this script creates, so -Undo deletes only those.
$Marker = 'NeoFullUrlAddressBar'
$BackupSuffix = '.before-neo-full-url.bak'
$PrefSettings = [ordered]@{
    'omnibox.prevent_url_elisions'     = $true
    'navigator.omnibox.use_full_width' = $true
    'navigator.omnibox.show_title'     = $false
}
$ExtensionSource = Join-Path $PSScriptRoot 'zoom-controls'
# Derived from the "key" in zoom-controls\manifest.json, so it is the same on every machine.
$ZoomExtensionId = 'pfoejdcoooobifjhbnemjanhjlkkgbea'
$InstallDir = Join-Path $env:LOCALAPPDATA 'NeoToolbarTweaks'
$InstalledScript = Join-Path $InstallDir 'Set-NeoFullUrlAddressBar.ps1'
$RunKeyPath = 'Software\Microsoft\Windows\CurrentVersion\Run'
$RunValueName = 'NeoToolbarTweaks'
$WantLogonEntry = -not $Undo -and (-not $NoLogonRepair -or $LaunchAtLogon)

$NeoExe = [IO.Path]::GetFullPath($NeoExe)
# Web app shortcuts start Neo through chrome_proxy.exe, which forwards its arguments.
$NeoLaunchers = @($NeoExe, (Join-Path (Split-Path $NeoExe) 'chrome_proxy.exe'))
$ExtensionDir = [IO.Path]::GetFullPath($ExtensionDir).TrimEnd('\')

if ($LogonRepair) {
    # Neo may be starting at the same time, so leave its Preferences alone.
    $SkipPreferences = $true
    New-Item -ItemType Directory -Force $InstallDir | Out-Null
    Start-Transcript -LiteralPath (Join-Path $InstallDir 'logon-repair.log') -Force | Out-Null
}
$ZoomAvailable = (Test-Path -LiteralPath (Join-Path $ExtensionSource 'manifest.json')) -or
    (Test-Path -LiteralPath (Join-Path $ExtensionDir 'manifest.json'))
$WantZoom = -not $Undo -and -not $NoZoomControls -and $ZoomAvailable

# Desired launch switches. Items are removed when not wanted, so re-running with
# -KeepVerticalTabsButton or -NoZoomControls also reverts that part.
$FeaturesOn = @('NavigatorReadOnlyOmnibox')
$FeaturesOff = @()
if ($Undo -or $KeepVerticalTabsButton) { $FeaturesOff += 'NeoVerticalTabs' } else { $FeaturesOn += 'NeoVerticalTabs' }
if ($Undo) { $FeaturesOff += $FeaturesOn; $FeaturesOn = @() }
$ExtensionsOn = if ($WantZoom) { @($ExtensionDir) } else { @() }
$ExtensionsOff = if ($WantZoom) { @() } else { @($ExtensionDir) }

$script:Changed = 0
$script:NeedsAdmin = @()

function Write-Step([string]$Message) { Write-Host "`n== $Message" -ForegroundColor Cyan }
function Write-Done([string]$Message) { $script:Changed++; Write-Host "  [改] $Message" -ForegroundColor Green }
function Write-Same([string]$Message) { Write-Host "  [=]  $Message" -ForegroundColor DarkGray }

function Get-NormalizedPath([string]$Path) {
    [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($Path)).TrimEnd('\')
}

# Adds and removes items of a comma-separated Chromium switch such as
# --disable-features=A,B. An existing switch is merged rather than duplicated,
# because Chromium only honours the last occurrence of a switch. A new switch
# goes before --single-argument, since everything after that is treated as one URL.
function Edit-SwitchList([string]$Arguments, [string]$Name, [string[]]$Add, [string[]]$Remove) {
    $Arguments = "$Arguments"
    # @(... | Where-Object) also turns a $null list into an empty one.
    $Add = @($Add | Where-Object { $_ })
    $Remove = @($Remove | Where-Object { $_ })
    $same = { param($a, $b) $a.TrimEnd('\') -ieq $b.TrimEnd('\') }
    $m = [regex]::Match($Arguments, "(^|\s+)--$([regex]::Escape($Name))=(?:""([^""]*)""|(\S*))")
    $items = @(if ($m.Success) { ($m.Groups[2].Value + $m.Groups[3].Value) -split ',' | Where-Object { $_ } })
    $result = @($items | Where-Object { $item = $_; -not ($Remove | Where-Object { & $same $item $_ }) })
    foreach ($wanted in $Add) {
        if (-not ($result | Where-Object { & $same $_ $wanted })) { $result += $wanted }
    }
    $value = $result -join ','
    $switch = if ($result.Count) { "--$Name=" + ($value -match '\s' ? """$value""" : $value) } else { '' }
    if ($m.Success) {
        $replacement = if ($switch) { $m.Groups[1].Value + $switch } else { '' }
        return ($Arguments.Substring(0, $m.Index) + $replacement + $Arguments.Substring($m.Index + $m.Length)).Trim()
    }
    if (-not $switch) { return $Arguments }
    $single = [regex]::Match($Arguments, '(?<=^|\s)--single-argument(?=\s|$)')
    if ($single.Success) { return $Arguments.Insert($single.Index, "$switch ") }
    return "$Arguments $switch".Trim()
}

function Edit-NeoSwitches([string]$Arguments) {
    $Arguments = Edit-SwitchList $Arguments 'disable-features' $FeaturesOn $FeaturesOff
    Edit-SwitchList $Arguments 'load-extension' $ExtensionsOn $ExtensionsOff
}

function Get-RunningNeo {
    $target = Get-NormalizedPath $UserDataDir
    $default = Get-NormalizedPath (Join-Path $env:LOCALAPPDATA 'Neo\User Data')
    Get-CimInstance Win32_Process -Filter "Name='neo.exe'" | Where-Object {
        # Only the browser process (child processes carry --type=) of the same
        # user data directory writes Preferences.
        if ($null -eq $_.CommandLine) { return $true }
        if ($_.CommandLine -match '\s--type=') { return $false }
        $dir = if ($_.CommandLine -match '--user-data-dir=(?:"([^"]+)"|(\S+))') { Get-NormalizedPath ($Matches[1] + $Matches[2]) } else { $default }
        $dir -ieq $target
    }
}

function Update-ZoomExtension {
    Write-Step "缩放按钮扩展文件（$ExtensionDir）"
    if (-not $WantZoom) {
        if (-not $Undo -and -not $NoZoomControls) {
            Write-Warning "未找到 $ExtensionSource，跳过缩放按钮（请用 git clone 或 Download ZIP 获取完整仓库）"
        }
        if (-not (Test-Path -LiteralPath $ExtensionDir)) { Write-Same '未部署'; return }
        if ($PSCmdlet.ShouldProcess($ExtensionDir, '删除')) {
            Remove-Item -LiteralPath $ExtensionDir -Recurse -Force
            $parent = Split-Path $ExtensionDir
            if (-not (Get-ChildItem -LiteralPath $parent -Force)) { Remove-Item -LiteralPath $parent }
            Write-Done "已删除 $ExtensionDir"
        }
        return
    }

    # Running the installed copy of this script: source and target are the same folder.
    if ($ExtensionDir -ieq (Get-NormalizedPath $ExtensionSource)) { Write-Same '使用已部署的版本'; return }
    if (-not (Test-Path -LiteralPath $ExtensionSource)) {
        Write-Warning "未找到 $ExtensionSource，沿用已部署的版本"
        return
    }
    $sourceFiles = Get-ChildItem -LiteralPath $ExtensionSource -Recurse -File
    $wanted = @{}
    $stale = @()
    foreach ($file in $sourceFiles) {
        $relative = [IO.Path]::GetRelativePath($ExtensionSource, $file.FullName)
        $wanted[$relative] = $true
        $target = Join-Path $ExtensionDir $relative
        if (-not (Test-Path -LiteralPath $target) -or
            (Get-FileHash -LiteralPath $target).Hash -ne (Get-FileHash -LiteralPath $file.FullName).Hash) {
            $stale += $relative
        }
    }
    $extra = @(if (Test-Path -LiteralPath $ExtensionDir) {
        Get-ChildItem -LiteralPath $ExtensionDir -Recurse -File |
            ForEach-Object { [IO.Path]::GetRelativePath($ExtensionDir, $_.FullName) } |
            Where-Object { -not $wanted.ContainsKey($_) }
    })
    if (-not $stale -and -not $extra) { Write-Same '已是最新'; return }
    if ($PSCmdlet.ShouldProcess($ExtensionDir, "从 $ExtensionSource 同步 $($stale.Count + $extra.Count) 个文件")) {
        foreach ($relative in $stale) {
            $target = Join-Path $ExtensionDir $relative
            New-Item -ItemType Directory -Force (Split-Path $target) | Out-Null
            Copy-Item -LiteralPath (Join-Path $ExtensionSource $relative) -Destination $target -Force
        }
        foreach ($relative in $extra) { Remove-Item -LiteralPath (Join-Path $ExtensionDir $relative) -Force }
        Write-Done "已同步 $($stale.Count + $extra.Count) 个文件到 $ExtensionDir"
    }
}

function Update-Preferences {
    Write-Step 'Profile 偏好（Preferences）'
    if (-not (Test-Path -LiteralPath $UserDataDir)) {
        Write-Warning "未找到 Neo 用户数据目录：$UserDataDir"
        return
    }
    $files = Get-ChildItem -LiteralPath $UserDataDir -Directory |
        Where-Object { $_.Name -eq 'Default' -or $_.Name -like 'Profile *' } |
        ForEach-Object { Join-Path $_.FullName 'Preferences' } |
        Where-Object { Test-Path -LiteralPath $_ }
    if (-not $files) {
        Write-Warning "$UserDataDir 下没有已初始化的 profile（请先正常启动并关闭一次 Neo）"
        return
    }

    $jsonOptions = [System.Text.Json.JsonSerializerOptions]::new()
    $jsonOptions.Encoder = [System.Text.Encodings.Web.JavaScriptEncoder]::UnsafeRelaxedJsonEscaping

    foreach ($file in $files) {
        # JsonNode keeps numbers and strings verbatim, unlike ConvertFrom-Json,
        # which rewrites date-like strings and number formats.
        $root = [System.Text.Json.Nodes.JsonNode]::Parse([IO.File]::ReadAllText($file))
        $edits = @()
        foreach ($entry in $PrefSettings.GetEnumerator()) {
            $parts = $entry.Key.Split('.')
            $parent = $root
            foreach ($part in $parts[0..($parts.Count - 2)]) {
                $next = $parent[$part]
                if ($next -isnot [System.Text.Json.Nodes.JsonObject]) {
                    if ($Undo) { $parent = $null; break }
                    $next = [System.Text.Json.Nodes.JsonObject]::new()
                    $parent[$part] = $next
                }
                $parent = $next
            }
            $leaf = $parts[-1]
            $current = $null
            if ($null -ne $parent) { $current = $parent[$leaf] }
            if ($Undo) {
                if ($null -ne $current) { [void]$parent.Remove($leaf); $edits += "$($entry.Key) 已移除（恢复默认）" }
            }
            elseif ($null -eq $current -or $current.ToJsonString() -cne ($entry.Value.ToString().ToLower())) {
                $parent[$leaf] = [System.Text.Json.Nodes.JsonValue]::Create([bool]$entry.Value)
                $edits += "$($entry.Key) = $($entry.Value.ToString().ToLower())"
            }
        }

        # Pin the zoom extension first, i.e. right next to the address bar. A
        # signed-in profile keeps an account-level copy of synced prefs under
        # account_values, which takes precedence over the local value, so every
        # copy that exists is updated. Plain assignments only: an if-expression
        # would unroll the JsonObject / JsonArray.
        $pinLists = @(@{ Owner = $root; Path = 'extensions.pinned_extensions'; Create = $true })
        $accountValues = $root['account_values']
        if ($accountValues -is [System.Text.Json.Nodes.JsonObject]) {
            $pinLists += @{ Owner = $accountValues; Path = 'account_values.extensions.pinned_extensions'; Create = $false }
        }
        foreach ($list in $pinLists) {
            $extensions = $list.Owner['extensions']
            $pinned = $null
            if ($extensions -is [System.Text.Json.Nodes.JsonObject]) { $pinned = $extensions['pinned_extensions'] }
            $pinnedAt = @(if ($pinned -is [System.Text.Json.Nodes.JsonArray]) {
                for ($i = $pinned.Count - 1; $i -ge 0; $i--) { if ("$($pinned[$i])" -ceq $ZoomExtensionId) { $i } }
            })
            if ($WantZoom -and $pinnedAt.Count -eq 0) {
                if ($pinned -isnot [System.Text.Json.Nodes.JsonArray]) {
                    # Without an account-level list the local one applies, so only that one is created.
                    if (-not $list.Create) { continue }
                    if ($extensions -isnot [System.Text.Json.Nodes.JsonObject]) {
                        $extensions = [System.Text.Json.Nodes.JsonObject]::new()
                        $list.Owner['extensions'] = $extensions
                    }
                    $pinned = [System.Text.Json.Nodes.JsonArray]::new()
                    $extensions['pinned_extensions'] = $pinned
                }
                $pinned.Insert(0, [System.Text.Json.Nodes.JsonValue]::Create([string]$ZoomExtensionId))
                $edits += "$($list.Path)：固定缩放按钮"
            }
            elseif (-not $WantZoom -and $pinnedAt.Count -gt 0) {
                foreach ($i in $pinnedAt) { $pinned.RemoveAt($i) }
                $edits += "$($list.Path)：取消固定缩放按钮"
            }
        }

        if (-not $edits) { Write-Same "$file 已是目标状态"; continue }
        if ($PSCmdlet.ShouldProcess($file, ($edits -join '; '))) {
            $backup = $file + $BackupSuffix
            if (-not (Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $file -Destination $backup }
            [IO.File]::WriteAllText($file, $root.ToJsonString($jsonOptions), [Text.UTF8Encoding]::new($false))
            Write-Done "$file`n         $($edits -join "`n         ")"
        }
    }
}

function Update-Shortcuts {
    Write-Step '快捷方式启动参数（Neo 与网页应用）'
    $shell = New-Object -ComObject WScript.Shell
    $found = 0
    foreach ($root in $ShortcutRoots | Where-Object { $_ -and (Test-Path -LiteralPath $_) }) {
        # -Force: taskbar pins live under the hidden "User Pinned" folder.
        foreach ($item in Get-ChildItem -LiteralPath $root -Recurse -Force -Filter *.lnk -File -ErrorAction SilentlyContinue) {
            $lnk = $shell.CreateShortcut($item.FullName)
            if (-not $lnk.TargetPath -or $NeoLaunchers -inotcontains (Get-NormalizedPath $lnk.TargetPath)) { continue }
            $found++
            $new = Edit-NeoSwitches $lnk.Arguments
            if ($new -ceq "$($lnk.Arguments)") { Write-Same $item.FullName; continue }
            if ($PSCmdlet.ShouldProcess($item.FullName, "参数改为 '$new'")) {
                try {
                    $lnk.Arguments = $new
                    $lnk.Save()
                    Write-Done "$($item.FullName)`n         参数：'$new'"
                }
                catch {
                    $script:NeedsAdmin += $item.FullName
                    Write-Warning "无法修改（需要管理员权限）：$($item.FullName)"
                }
            }
        }
    }
    if (-not $found) { Write-Warning "没有找到启动 Neo 的快捷方式" }
}

# ProgIds and protocols whose open command launches Neo, from both hives (HKCU
# entries include the overrides this script created earlier).
function Find-NeoProgIds {
    $launcher = '(?i)' + [regex]::Escape((Split-Path $NeoExe)) + '\\(neo|chrome_proxy)\.exe'
    $names = foreach ($hive in [Microsoft.Win32.Registry]::CurrentUser, [Microsoft.Win32.Registry]::LocalMachine) {
        $classes = $hive.OpenSubKey('Software\Classes')
        try {
            foreach ($name in $classes.GetSubKeyNames()) {
                $command = $classes.OpenSubKey("$name\shell\open\command")
                if (-not $command) { continue }
                if ("$($command.GetValue(''))" -match $launcher) { $name }
                $command.Dispose()
            }
        }
        finally { $classes.Dispose() }
    }
    @($names | Sort-Object -Unique)
}

function Update-UrlHandlers {
    Write-Step '注册表中启动 Neo 的命令（链接、文件、协议）'
    $targets = if ($ProgIds) { $ProgIds } else { Find-NeoProgIds }
    foreach ($progId in $targets) {
        $userPath = "Software\Classes\$progId"
        $userKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($userPath, $true)
        $machineKey = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey("Software\Classes\$progId")
        try {
            if ($Undo) {
                if (-not $userKey) { Write-Same "HKCU\$userPath 不存在"; continue }
                if ($userKey.GetValue($Marker)) {
                    if ($PSCmdlet.ShouldProcess("HKCU\$userPath", '删除本脚本创建的注册项')) {
                        $userKey.Dispose(); $userKey = $null
                        [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($userPath)
                        Write-Done "已删除 HKCU\$userPath"
                    }
                    continue
                }
            }
            elseif (-not $userKey) {
                $machineCommand = $null
                if ($machineKey) {
                    $machineCommandKey = $machineKey.OpenSubKey('shell\open\command')
                    if ($machineCommandKey) { $machineCommand = $machineCommandKey.GetValue(''); $machineCommandKey.Dispose() }
                }
                if (-not $machineCommand) { Write-Same "未注册 $progId，跳过"; continue }
                $new = Edit-NeoSwitches $machineCommand
                if ($PSCmdlet.ShouldProcess("HKCU\$userPath", "新建，打开命令为 $new")) {
                    $created = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($userPath)
                    try {
                        # A per-user ProgId key shadows the machine key's own values,
                        # so copy them (display name, AppUserModelId) across.
                        foreach ($name in $machineKey.GetValueNames()) {
                            $created.SetValue($name, $machineKey.GetValue($name, $null, 'DoNotExpandEnvironmentNames'), $machineKey.GetValueKind($name))
                        }
                        $created.SetValue($Marker, 1, 'DWord')
                        $command = $created.CreateSubKey('shell\open\command')
                        $command.SetValue('', $new, 'String')
                        $command.Dispose()
                    }
                    finally { $created.Dispose() }
                    Write-Done "HKCU\$userPath`n         打开命令：$new"
                }
                continue
            }

            # The per-user key exists (created earlier by this script, or by
            # someone else): edit its command in place.
            $commandKey = $userKey.OpenSubKey('shell\open\command', $true)
            if (-not $commandKey) { Write-Same "HKCU\$userPath 没有打开命令，跳过"; continue }
            try {
                $current = "$($commandKey.GetValue('', $null, 'DoNotExpandEnvironmentNames'))"
                $new = Edit-NeoSwitches $current
                if ($new -ceq $current) { Write-Same "HKCU\$userPath\shell\open\command"; continue }
                if ($PSCmdlet.ShouldProcess("HKCU\$userPath\shell\open\command", "改为 $new")) {
                    $commandKey.SetValue('', $new, $commandKey.GetValueKind(''))
                    Write-Done "HKCU\$userPath\shell\open\command`n         打开命令：$new"
                }
            }
            finally { $commandKey.Dispose() }
        }
        finally {
            if ($userKey) { $userKey.Dispose() }
            if ($machineKey) { $machineKey.Dispose() }
        }
    }
}

# The Run entry starts the installed copy of this script without a console window
# and passes on the options of this run, so the logon repair keeps them.
function Get-LogonCommand {
    $parts = @(
        "`"$(Join-Path $env:SystemRoot 'System32\conhost.exe')`"", '--headless',
        "`"$((Get-Process -Id $PID).Path)`"", '-NoProfile', '-ExecutionPolicy', 'Bypass',
        '-File', "`"$InstalledScript`"", '-LogonRepair'
    )
    foreach ($name in 'KeepVerticalTabsButton', 'NoZoomControls', 'LaunchAtLogon') {
        if ($ScriptParameters[$name]) { $parts += "-$name" }
    }
    foreach ($name in 'UserDataDir', 'NeoExe', 'ExtensionDir') {
        if ($ScriptParameters.ContainsKey($name)) { $parts += "-$name", "`"$($ScriptParameters[$name])`"" }
    }
    $parts -join ' '
}

function Update-LogonEntry {
    Write-Step "登录时自动修补（HKCU\$RunKeyPath\$RunValueName）"
    $runKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($RunKeyPath)
    try {
        $current = $runKey.GetValue($RunValueName)
        if (-not $WantLogonEntry) {
            if ($null -eq $current) { Write-Same '未设置' }
            elseif ($PSCmdlet.ShouldProcess("HKCU\$RunKeyPath\$RunValueName", '删除')) {
                $runKey.DeleteValue($RunValueName)
                Write-Done "已删除 HKCU\$RunKeyPath\$RunValueName"
            }
            foreach ($file in $InstalledScript, (Join-Path $InstallDir 'logon-repair.log')) {
                if ((Test-Path -LiteralPath $file) -and $PSCmdlet.ShouldProcess($file, '删除')) {
                    Remove-Item -LiteralPath $file -Force
                    Write-Done "已删除 $file"
                }
            }
            if ((Test-Path -LiteralPath $InstallDir) -and -not (Get-ChildItem -LiteralPath $InstallDir -Force) -and
                $PSCmdlet.ShouldProcess($InstallDir, '删除空目录')) {
                Remove-Item -LiteralPath $InstallDir
            }
            return
        }

        if ((Get-NormalizedPath $PSCommandPath) -ine (Get-NormalizedPath $InstalledScript)) {
            if ((Test-Path -LiteralPath $InstalledScript) -and
                (Get-FileHash -LiteralPath $InstalledScript).Hash -eq (Get-FileHash -LiteralPath $PSCommandPath).Hash) {
                Write-Same "$InstalledScript 已是最新"
            }
            elseif ($PSCmdlet.ShouldProcess($InstalledScript, '复制本脚本')) {
                New-Item -ItemType Directory -Force $InstallDir | Out-Null
                Copy-Item -LiteralPath $PSCommandPath -Destination $InstalledScript -Force
                Write-Done "已复制脚本到 $InstalledScript"
            }
        }
        $command = Get-LogonCommand
        if ($current -ceq $command) { Write-Same $command }
        elseif ($PSCmdlet.ShouldProcess("HKCU\$RunKeyPath\$RunValueName", "设为 $command")) {
            $runKey.SetValue($RunValueName, $command, 'String')
            Write-Done "HKCU\$RunKeyPath\$RunValueName`n         $command"
        }
    }
    finally { $runKey.Dispose() }
}

if (-not (Test-Path -LiteralPath $NeoExe)) { throw "未找到 Neo：$NeoExe（可用 -NeoExe 指定路径）" }

if (-not $SkipPreferences -and (Get-RunningNeo)) {
    $message = 'Neo 仍在运行（可能在后台/托盘）。请先完全退出 Neo，否则它退出时会覆盖 Preferences 的改动。'
    if ($WhatIfPreference) { Write-Warning $message } else { throw $message }
}

Write-Host ($Undo ? '撤销 Neo 工具栏调整' : '应用 Neo 工具栏调整') -ForegroundColor Yellow
Update-ZoomExtension
if (-not $SkipPreferences) { Update-Preferences }
if (-not $SkipShortcuts) { Update-Shortcuts }
if (-not $SkipUrlHandlers) { Update-UrlHandlers }
if (-not $LogonRepair) { Update-LogonEntry }

if ($LogonRepair) {
    if ($LaunchAtLogon -and -not $Undo) {
        if (Get-RunningNeo) { Write-Same 'Neo 已在运行，不再启动' }
        else {
            $arguments = Edit-NeoSwitches ''
            if ($ScriptParameters.ContainsKey('UserDataDir')) { $arguments = "--user-data-dir=`"$UserDataDir`" $arguments" }
            Start-Process -FilePath $NeoExe -ArgumentList $arguments
            Write-Done "已启动 Neo：$arguments"
        }
    }
    Stop-Transcript | Out-Null
    return
}

if ($script:NeedsAdmin) {
    Write-Host "`n以下快捷方式需要管理员权限才能修改（例如开始菜单搜索「Neo」打开的就是它）：" -ForegroundColor Yellow
    $script:NeedsAdmin | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
    Write-Host '请以管理员身份打开 PowerShell，用相同的参数再运行一次本脚本。' -ForegroundColor Yellow
}
if ($WhatIfPreference) {
    Write-Host "`n以上为预览（-WhatIf），未写入任何改动。" -ForegroundColor Yellow
}
elseif ($script:Changed) {
    Write-Host "`n完成，共 $script:Changed 处改动。请完全退出 Neo，再从任务栏或开始菜单重新打开。" -ForegroundColor Yellow
}
else {
    Write-Host "`n没有需要改动的地方。" -ForegroundColor Yellow
}
