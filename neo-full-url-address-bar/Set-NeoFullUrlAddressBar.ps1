#Requires -Version 7.2
<#
.SYNOPSIS
    让 Neo 浏览器地址栏始终显示完整 URL，并占满工具栏宽度。

.DESCRIPTION
    Neo's address bar is browser UI (a <readonly-omnibox> WebUI element on a
    chrome:// surface), not part of any web page, so userscript managers such as
    Tampermonkey cannot reach it. This script applies the browser-level settings
    that do work:

    1. Disables the Neo feature NavigatorReadOnlyOmnibox by adding
       --disable-features=NavigatorReadOnlyOmnibox to
         - every shortcut that targets neo.exe (Start menu, taskbar pins, desktop)
         - the "open link" command used when Neo is the default browser
           (HKCU\Software\Classes\NeoHTM / NeoPDF, which override the HKLM
           registration without needing admin rights).
       Without this feature Neo falls back to the standard Chromium omnibox,
       which honours "always show full URLs" instead of showing the domain only.
    2. Writes these profile preferences:
         omnibox.prevent_url_elisions     = true   full URL including https://
         navigator.omnibox.use_full_width = true   "Use full address bar width"
         navigator.omnibox.show_title     = false  never replace the URL with the page title

    Neo must be fully closed while the script runs. -Undo reverts everything and
    -WhatIf previews the changes without writing anything.

.EXAMPLE
    pwsh -File .\Set-NeoFullUrlAddressBar.ps1 -WhatIf
.EXAMPLE
    pwsh -File .\Set-NeoFullUrlAddressBar.ps1
.EXAMPLE
    pwsh -File .\Set-NeoFullUrlAddressBar.ps1 -Undo
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$Undo,
    [string]$UserDataDir = (Join-Path $env:LOCALAPPDATA 'Neo\User Data'),
    [string]$NeoExe = (Join-Path $env:ProgramFiles 'Neo\Application\neo.exe'),
    [string[]]$ShortcutRoots = @(
        (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu'),
        (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch'),
        [Environment]::GetFolderPath('Desktop'),
        (Join-Path $env:ProgramData 'Microsoft\Windows\Start Menu'),
        (Join-Path $env:PUBLIC 'Desktop')
    ),
    [string[]]$ProgIds = @('NeoHTM', 'NeoPDF'),
    [switch]$SkipPreferences,
    [switch]$SkipShortcuts,
    [switch]$SkipUrlHandlers
)

$ErrorActionPreference = 'Stop'

$Feature = 'NavigatorReadOnlyOmnibox'
# Set on HKCU ProgId keys this script creates, so -Undo deletes only those.
$Marker = 'NeoFullUrlAddressBar'
$BackupSuffix = '.before-neo-full-url.bak'
$PrefSettings = [ordered]@{
    'omnibox.prevent_url_elisions'     = $true
    'navigator.omnibox.use_full_width' = $true
    'navigator.omnibox.show_title'     = $false
}

$script:Changed = 0

function Write-Step([string]$Message) { Write-Host "`n== $Message" -ForegroundColor Cyan }
function Write-Done([string]$Message) { $script:Changed++; Write-Host "  [改] $Message" -ForegroundColor Green }
function Write-Same([string]$Message) { Write-Host "  [=]  $Message" -ForegroundColor DarkGray }

function Get-NormalizedPath([string]$Path) {
    [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($Path)).TrimEnd('\')
}

# Adds or removes NavigatorReadOnlyOmnibox in a Chromium command line.
# An existing --disable-features switch is merged rather than duplicated, because
# Chromium only honours the last occurrence of a switch. A new switch goes before
# --single-argument, since everything after that is treated as one URL.
function Edit-FeatureSwitch([string]$Arguments, [bool]$Disable) {
    $Arguments = "$Arguments"
    $m = [regex]::Match($Arguments, '(^|\s+)--disable-features=(\S*)')
    if ($m.Success) {
        $features = @($m.Groups[2].Value -split ',' | Where-Object { $_ -and $_ -ne $Feature })
        if ($Disable) { $features += $Feature }
        $replacement = if ($features.Count) { $m.Groups[1].Value + '--disable-features=' + ($features -join ',') } else { '' }
        return ($Arguments.Substring(0, $m.Index) + $replacement + $Arguments.Substring($m.Index + $m.Length)).Trim()
    }
    if (-not $Disable) { return $Arguments }
    $switch = "--disable-features=$Feature"
    $single = [regex]::Match($Arguments, '(?<=^|\s)--single-argument(?=\s|$)')
    if ($single.Success) { return $Arguments.Insert($single.Index, "$switch ") }
    return "$Arguments $switch".Trim()
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
            $current = if ($null -ne $parent) { $parent[$leaf] } else { $null }
            if ($Undo) {
                if ($null -ne $current) { [void]$parent.Remove($leaf); $edits += "$($entry.Key) 已移除（恢复默认）" }
            }
            elseif ($null -eq $current -or $current.ToJsonString() -cne ($entry.Value.ToString().ToLower())) {
                $parent[$leaf] = [System.Text.Json.Nodes.JsonValue]::Create([bool]$entry.Value)
                $edits += "$($entry.Key) = $($entry.Value.ToString().ToLower())"
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
    Write-Step '快捷方式启动参数'
    $exe = Get-NormalizedPath $NeoExe
    $shell = New-Object -ComObject WScript.Shell
    $found = 0
    foreach ($root in $ShortcutRoots | Where-Object { $_ -and (Test-Path -LiteralPath $_) }) {
        # -Force: taskbar pins live under the hidden "User Pinned" folder.
        foreach ($item in Get-ChildItem -LiteralPath $root -Recurse -Force -Filter *.lnk -File -ErrorAction SilentlyContinue) {
            $lnk = $shell.CreateShortcut($item.FullName)
            if (-not $lnk.TargetPath -or (Get-NormalizedPath $lnk.TargetPath) -ine $exe) { continue }
            $found++
            $new = Edit-FeatureSwitch $lnk.Arguments (-not $Undo)
            if ($new -ceq "$($lnk.Arguments)") { Write-Same $item.FullName; continue }
            if ($PSCmdlet.ShouldProcess($item.FullName, "参数改为 '$new'")) {
                try {
                    $lnk.Arguments = $new
                    $lnk.Save()
                    Write-Done "$($item.FullName)`n         参数：'$new'"
                }
                catch {
                    Write-Warning "无法修改（该位置需要管理员权限，可用管理员 PowerShell 重跑）：$($item.FullName)"
                }
            }
        }
    }
    if (-not $found) { Write-Warning "没有找到指向 $exe 的快捷方式" }
}

function Update-UrlHandlers {
    Write-Step '默认浏览器打开链接的命令（HKCU\Software\Classes）'
    foreach ($progId in $ProgIds) {
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
                $new = Edit-FeatureSwitch $machineCommand $true
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

            # A per-user registration already exists (not created by this script): edit its command in place.
            $commandKey = $userKey.OpenSubKey('shell\open\command', $true)
            if (-not $commandKey) { Write-Same "HKCU\$userPath 没有打开命令，跳过"; continue }
            try {
                $current = "$($commandKey.GetValue('', $null, 'DoNotExpandEnvironmentNames'))"
                $new = Edit-FeatureSwitch $current (-not $Undo)
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

if (-not (Test-Path -LiteralPath $NeoExe)) { throw "未找到 Neo：$NeoExe（可用 -NeoExe 指定路径）" }

if (-not $SkipPreferences -and (Get-RunningNeo)) {
    $message = 'Neo 仍在运行（可能在后台/托盘）。请先完全退出 Neo，否则它退出时会覆盖 Preferences 的改动。'
    if ($WhatIfPreference) { Write-Warning $message } else { throw $message }
}

Write-Host ($Undo ? '撤销 Neo 完整 URL 地址栏设置' : '应用 Neo 完整 URL 地址栏设置') -ForegroundColor Yellow
if (-not $SkipPreferences) { Update-Preferences }
if (-not $SkipShortcuts) { Update-Shortcuts }
if (-not $SkipUrlHandlers) { Update-UrlHandlers }

if ($WhatIfPreference) {
    Write-Host "`n以上为预览（-WhatIf），未写入任何改动。" -ForegroundColor Yellow
}
elseif ($script:Changed) {
    Write-Host "`n完成，共 $script:Changed 处改动。现在从任务栏/开始菜单重新打开 Neo 即可生效。" -ForegroundColor Yellow
}
else {
    Write-Host "`n没有需要改动的地方。" -ForegroundColor Yellow
}
