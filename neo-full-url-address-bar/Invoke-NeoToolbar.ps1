#Requires -Version 7.2
<# Installed alongside settings.json. RepairOnly is used at Windows sign-in. #>
[CmdletBinding()]
param([switch]$RepairOnly, [string]$Url)
$ErrorActionPreference = 'Stop'
$logPath = Join-Path $PSScriptRoot 'last-repair.log'
try {
    . (Join-Path $PSScriptRoot 'NeoPaths.ps1')
    $settings = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'settings.json') -Raw | ConvertFrom-Json
    if ($settings.Owner -ne 'NeoFullUrlAddressBar' -or $settings.SchemaVersion -ne 1) { throw '无法识别本机工具栏设置，请重新运行安装脚本。' }
    $preferred = [string]$settings.PreferredNeoExe
    if ($preferred -and (Test-Path -LiteralPath $preferred -PathType Leaf)) {
        $neoExe = Resolve-NeoExecutable -ExplicitPath $preferred
    }
    else {
        $neoExe = Resolve-NeoExecutable -HintPath $settings.NeoExeHint -ShortcutRoots $settings.ShortcutRoots -ProgIds $settings.ProgIds
    }
    $parameters = @{ NeoExe = $neoExe; Maintenance = $true }
    foreach ($name in @('UserDataDir', 'ExtensionDir', 'StateDir', 'ShortcutRoots', 'ProgIds',
        'KeepVerticalTabsButton', 'NoZoomControls', 'SkipPreferences', 'SkipShortcuts', 'SkipUrlHandlers', 'SkipAutoStart', 'NoAutoRepair')) {
        $parameters[$name] = $settings.$name
    }
    # Maintenance never kills Neo or writes Preferences, even before Neo starts.
    $output = & (Join-Path $PSScriptRoot 'Set-NeoFullUrlAddressBar.ps1') @parameters *>&1
    $output | Out-String | Set-Content -LiteralPath $logPath -Encoding utf8
    if (-not $RepairOnly) {
        $features = 'NavigatorReadOnlyOmnibox'
        if (-not $settings.KeepVerticalTabsButton) { $features += ',NeoVerticalTabs' }
        $arguments = '--disable-features=' + $features
        if (-not $settings.NoZoomControls -and (Test-Path -LiteralPath (Join-Path $settings.ExtensionDir 'manifest.json') -PathType Leaf)) {
            $arguments += ' --load-extension="' + $settings.ExtensionDir + '"'
        }
        # A custom user-data directory must be used both when editing and launching;
        # the default one is left implicit, exactly as Neo's own shortcuts do.
        $defaultUserData = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Neo\User Data')).TrimEnd('\')
        if ([IO.Path]::GetFullPath($settings.UserDataDir).TrimEnd('\') -ine $defaultUserData) {
            $arguments += ' --user-data-dir="' + $settings.UserDataDir + '"'
        }
        if ($Url) {
            if ($Url.Contains('"') -or $Url.Contains("`r") -or $Url.Contains("`n")) { throw '网址包含无效字符。' }
            $arguments += ' --single-argument "' + $Url + '"'
        }
        Start-Process -FilePath $neoExe -ArgumentList $arguments
    }
}
catch {
    $failure = "$(Get-Date -Format o)`n$($_ | Out-String)"
    Set-Content -LiteralPath $logPath -Value $failure -Encoding utf8
    if (-not $RepairOnly) {
        # The managed shortcut runs hidden; surface failures without keeping a console open.
        try { (New-Object -ComObject WScript.Shell).Popup("Neo 工具栏启动失败：$($_.Exception.Message)`n详情：$logPath", 0, 'Neo 工具栏增强', 16) | Out-Null } catch { }
    }
    exit 1
}
