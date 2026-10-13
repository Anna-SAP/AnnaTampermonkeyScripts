#Requires -Version 7.2
<#
.SYNOPSIS
    Neo 浏览器工具栏调整：地址栏始终显示完整 URL 并占满宽度，移除垂直选项卡按钮，新增页面缩放按钮。

.DESCRIPTION
    Neo's toolbar is browser UI (the address bar is a <readonly-omnibox> WebUI
    element on a chrome:// surface), not part of any web page, so userscript
    managers such as Tampermonkey cannot reach it. This script applies the
    browser-level settings that do work:

    1. Launch switches, added to every shortcut that targets neo.exe (Start menu,
       taskbar pins, desktop) and to the "open link" command used when Neo is the
       default browser (HKCU\Software\Classes\NeoHTM / NeoPDF, which override the
       HKLM registration without needing admin rights):
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

    Neo must be fully closed while the script runs. -Undo reverts everything and
    -WhatIf previews the changes without writing anything.

.EXAMPLE
    pwsh -File .\Set-NeoFullUrlAddressBar.ps1 -WhatIf
.EXAMPLE
    pwsh -File .\Set-NeoFullUrlAddressBar.ps1
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
    [string[]]$ProgIds = @('NeoHTM', 'NeoPDF'),
    [switch]$SkipPreferences,
    [switch]$SkipShortcuts,
    [switch]$SkipUrlHandlers
)

$ErrorActionPreference = 'Stop'

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

$ExtensionDir = [IO.Path]::GetFullPath($ExtensionDir).TrimEnd('\')
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
    if ($ExtensionDir -ieq (Get-NormalizedPath $ExtensionSource)) { Write-Same '直接使用仓库中的 zoom-controls'; return }

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
            $new = Edit-NeoSwitches $lnk.Arguments
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

if ($WhatIfPreference) {
    Write-Host "`n以上为预览（-WhatIf），未写入任何改动。" -ForegroundColor Yellow
}
elseif ($script:Changed) {
    Write-Host "`n完成，共 $script:Changed 处改动。现在从任务栏/开始菜单重新打开 Neo 即可生效。" -ForegroundColor Yellow
}
else {
    Write-Host "`n没有需要改动的地方。" -ForegroundColor Yellow
}
