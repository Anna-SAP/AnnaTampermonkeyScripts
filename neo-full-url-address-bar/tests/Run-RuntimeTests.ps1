#Requires -Version 7.2
<#
.SYNOPSIS
    Isolated integration tests for the deployed Neo toolbar launcher.
.DESCRIPTION
    Runs a copy of the real launcher with fake path discovery and maintenance
    scripts. Empty neo.exe fixtures are never executed. Process launches and COM
    creation are intercepted; the tests do not inspect actual browser state.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$script:Passed = 0
$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/')
$testName = 'NeoRuntimeTests-' + [guid]::NewGuid().ToString('N')
$testRoot = [IO.Path]::GetFullPath((Join-Path $tempBase $testName))
$testRootPrefix = $testRoot.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
$deployed = Join-Path $testRoot '部署 目录'
$runnerPath = Join-Path $deployed 'Invoke-NeoToolbar.ps1'
$savedTestEnvironment = [Environment]::GetEnvironmentVariable('NEO_TOOLBAR_RUNTIME_TEST_ROOT', 'Process')
$exitCodeVariable = Get-Variable -Name LASTEXITCODE -Scope Global -ErrorAction SilentlyContinue
$hadExitCodeVariable = $null -ne $exitCodeVariable
$savedExitCode = if ($hadExitCodeVariable) { $exitCodeVariable.Value } else { $null }

function Assert-Equal($Actual, $Expected) {
    if ($Actual -cne $Expected) { throw "Expected [$Expected], received [$Actual]." }
}

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Invoke-TestCase([string]$Name, [scriptblock]$Action) {
    try {
        & $Action
        $script:Passed++
        Write-Host "[PASS] $Name"
    } catch { throw "[FAIL] $Name`: $($_.Exception.Message)" }
}

function New-EmptyFixture([string]$RelativePath) {
    $path = [IO.Path]::GetFullPath((Join-Path $testRoot $RelativePath))
    if (-not $path.StartsWith($testRootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Fixture path escapes temporary test directory: $path"
    }
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $path))
    [IO.File]::WriteAllBytes($path, [byte[]]::new(0))
    $path
}

function Write-TestSettings($Settings) {
    [IO.File]::WriteAllText((Join-Path $deployed 'settings.json'), ($Settings | ConvertTo-Json -Depth 5))
}

function New-TestSettings {
    [ordered]@{
        Owner = 'NeoFullUrlAddressBar'
        SchemaVersion = 1
        PreferredNeoExe = ''
        NeoExeHint = $oldExe
        UserDataDir = (Join-Path $testRoot '浏览器 配置\User Data')
        ExtensionDir = $extensionDir
        StateDir = $deployed
        ShortcutRoots = @((Join-Path $testRoot 'Desktop'), (Join-Path $testRoot 'Start Menu'))
        ProgIds = @('NeoHTM', 'NeoPDF')
        KeepVerticalTabsButton = $false
        NoZoomControls = $false
        SkipPreferences = $false
        SkipShortcuts = $false
        SkipUrlHandlers = $false
        SkipAutoStart = $false
        NoAutoRepair = $false
    }
}

function Reset-Records {
    foreach ($name in @('resolve-call.json', 'maintenance-call.json', 'launch-call.json', 'com-denied.log', 'last-repair.log')) {
        $path = Join-Path $deployed $name
        if (Test-Path -LiteralPath $path -PathType Leaf) { Remove-Item -LiteralPath $path -Force }
    }
    $script:RunnerExitCode = 0
}

function Read-Record([string]$Name) {
    Get-Content -LiteralPath (Join-Path $deployed $Name) -Raw | ConvertFrom-Json
}

function Invoke-TestRunner([switch]$RepairOnly, [string]$Url) {
    $parameters = @{}
    if ($RepairOnly) { $parameters.RepairOnly = $true }
    if ($PSBoundParameters.ContainsKey('Url')) { $parameters.Url = $Url }
    $global:LASTEXITCODE = 0
    & $runnerPath @parameters
    $script:RunnerExitCode = $global:LASTEXITCODE
}

# These functions are inherited by the invoked launcher. No process or COM
# object is ever created, including on the launcher's error-reporting branch.
function Start-Process {
    [CmdletBinding()]
    param([string]$FilePath, [string[]]$ArgumentList)
    $root = $env:NEO_TOOLBAR_RUNTIME_TEST_ROOT
    if (-not (Test-Path -LiteralPath (Join-Path $root 'maintenance-call.json') -PathType Leaf)) {
        throw 'Launcher attempted to start Neo before maintenance.'
    }
    $record = [ordered]@{ FilePath = $FilePath; ArgumentList = ($ArgumentList -join ' ') }
    [IO.File]::WriteAllText((Join-Path $root 'launch-call.json'), ($record | ConvertTo-Json))
}

function New-Object {
    [CmdletBinding()]
    param([string]$ComObject, [string]$TypeName, [object[]]$ArgumentList)
    [IO.File]::AppendAllText((Join-Path $env:NEO_TOOLBAR_RUNTIME_TEST_ROOT 'com-denied.log'), "Blocked COM/object creation: $ComObject $TypeName`n")
    throw 'COM/object creation is disabled by runtime tests.'
}

try {
    [void][IO.Directory]::CreateDirectory($deployed)
    $env:NEO_TOOLBAR_RUNTIME_TEST_ROOT = $deployed
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\Invoke-NeoToolbar.ps1') -Destination $runnerPath
    $currentExe = New-EmptyFixture '当前 Neo\neo.exe'
    $oldExe = New-EmptyFixture '旧版 Neo\neo.exe'
    $preferredExe = New-EmptyFixture '手动指定 Neo\neo.exe'
    $extensionDir = Join-Path $testRoot '缩放 扩展'
    $manifestPath = New-EmptyFixture '缩放 扩展\manifest.json'
    [IO.File]::WriteAllText((Join-Path $deployed 'current-exe.txt'), $currentExe)

    # This fake provider records how the real runner invokes path discovery.
    $pathProvider = @'
function Resolve-NeoExecutable {
    [CmdletBinding()]
    param([string]$ExplicitPath, [string]$HintPath, [string[]]$ShortcutRoots, [string[]]$ProgIds)
    $record = [ordered]@{
        ExplicitPath = $ExplicitPath
        HintPath = $HintPath
        ShortcutRoots = @($ShortcutRoots)
        ProgIds = @($ProgIds)
        BoundNames = @($PSBoundParameters.Keys)
    }
    [IO.File]::WriteAllText((Join-Path $PSScriptRoot 'resolve-call.json'), ($record | ConvertTo-Json -Depth 5))
    if ($ExplicitPath) { return $ExplicitPath }
    [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'current-exe.txt'))
}
'@
    [IO.File]::WriteAllText((Join-Path $deployed 'NeoPaths.ps1'), $pathProvider)

    # Accept the production main script's complete parameter surface but only
    # record it. No actual maintenance code or browser preferences are loaded.
    $maintenanceProvider = @'
[CmdletBinding(SupportsShouldProcess)]
param(
    [switch]$Undo,
    [switch]$KeepVerticalTabsButton,
    [switch]$NoZoomControls,
    [string]$UserDataDir,
    [string]$NeoExe,
    [string]$ExtensionDir,
    [string]$StateDir,
    [string[]]$ShortcutRoots,
    [string[]]$ProgIds,
    [switch]$SkipPreferences,
    [switch]$SkipShortcuts,
    [switch]$SkipUrlHandlers,
    [switch]$SkipAutoStart,
    [switch]$NoAutoRepair,
    [switch]$Maintenance
)
$record = [ordered]@{}
foreach ($entry in $PSBoundParameters.GetEnumerator()) {
    $record[$entry.Key] = if ($entry.Value -is [System.Management.Automation.SwitchParameter]) { [bool]$entry.Value } else { $entry.Value }
}
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'maintenance-call.json'), ($record | ConvertTo-Json -Depth 5))
Write-Output 'FAKE_MAINTENANCE_COMPLETED'
'@
    [IO.File]::WriteAllText((Join-Path $deployed 'Set-NeoFullUrlAddressBar.ps1'), $maintenanceProvider)

    Invoke-TestCase 'RepairOnly maintains the deployed state without starting Neo' {
        Reset-Records
        $settings = New-TestSettings
        Write-TestSettings $settings
        Invoke-TestRunner -RepairOnly
        $maintenance = Read-Record 'maintenance-call.json'
        Assert-Equal $maintenance.NeoExe $currentExe
        Assert-Equal $maintenance.Maintenance $true
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $deployed 'launch-call.json'))) 'RepairOnly launched Neo.'
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $deployed 'com-denied.log'))) 'RepairOnly attempted COM creation.'
        Assert-Equal $script:RunnerExitCode 0
    }
    Invoke-TestCase 'Maintenance forwards custom profile, deployment and discovery settings' {
        $settings = Read-Record 'settings.json'
        $maintenance = Read-Record 'maintenance-call.json'
        Assert-Equal $maintenance.UserDataDir $settings.UserDataDir
        Assert-Equal $maintenance.ExtensionDir $settings.ExtensionDir
        Assert-Equal $maintenance.StateDir $settings.StateDir
        Assert-Equal ($maintenance.ShortcutRoots -join '|') ($settings.ShortcutRoots -join '|')
        Assert-Equal ($maintenance.ProgIds -join '|') ($settings.ProgIds -join '|')
    }
    Invoke-TestCase 'Maintenance output is saved in the deployed repair log' {
        Assert-True ((Get-Content -LiteralPath (Join-Path $deployed 'last-repair.log') -Raw).Contains('FAKE_MAINTENANCE_COMPLETED')) 'Repair log lacks maintenance output.'
    }
    Invoke-TestCase 'Manual launch uses current Neo, both feature switches, extension and custom profile' {
        Reset-Records
        $settings = New-TestSettings
        Write-TestSettings $settings
        Invoke-TestRunner
        $launch = Read-Record 'launch-call.json'
        Assert-Equal $launch.FilePath $currentExe
        $expected = '--disable-features=NavigatorReadOnlyOmnibox,NeoVerticalTabs --load-extension="' + $extensionDir + '" --user-data-dir="' + $settings.UserDataDir + '"'
        Assert-Equal $launch.ArgumentList $expected
        Assert-Equal $script:RunnerExitCode 0
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $deployed 'com-denied.log'))) 'Successful launch attempted COM creation.'
    }
    Invoke-TestCase 'NoZoomControls omits the extension even when its manifest exists' {
        Reset-Records
        $settings = New-TestSettings
        $settings.NoZoomControls = $true
        Write-TestSettings $settings
        Invoke-TestRunner
        Assert-True ((Read-Record 'launch-call.json').ArgumentList -notmatch '--load-extension') 'Disabled extension was loaded.'
        Assert-Equal (Read-Record 'maintenance-call.json').NoZoomControls $true
    }
    Invoke-TestCase 'Default profile directory is left implicit like Neo shortcuts' {
        Reset-Records
        $settings = New-TestSettings
        $settings.UserDataDir = Join-Path $env:LOCALAPPDATA 'Neo\User Data\'
        Write-TestSettings $settings
        Invoke-TestRunner
        $arguments = (Read-Record 'launch-call.json').ArgumentList
        Assert-True ($arguments -notmatch '--user-data-dir') 'Default user-data directory was passed explicitly.'
        Assert-True ($arguments -match 'NavigatorReadOnlyOmnibox') 'Omnibox launch switch is missing.'
    }
    Invoke-TestCase 'KeepVerticalTabsButton leaves only the omnibox feature switch' {
        Reset-Records
        $settings = New-TestSettings
        $settings.KeepVerticalTabsButton = $true
        Write-TestSettings $settings
        Invoke-TestRunner
        $arguments = (Read-Record 'launch-call.json').ArgumentList
        Assert-True ($arguments.StartsWith('--disable-features=NavigatorReadOnlyOmnibox ')) 'Omnibox launch switch is missing.'
        Assert-True ($arguments -notmatch 'NeoVerticalTabs') 'Vertical tabs were disabled despite KeepVerticalTabsButton.'
        Assert-Equal (Read-Record 'maintenance-call.json').KeepVerticalTabsButton $true
    }
    Invoke-TestCase 'Missing extension manifest prevents loading an incomplete extension' {
        Reset-Records
        $settings = New-TestSettings
        $settings.ExtensionDir = Join-Path $testRoot 'Missing Extension'
        Write-TestSettings $settings
        Invoke-TestRunner
        Assert-True ((Read-Record 'launch-call.json').ArgumentList -notmatch '--load-extension') 'Missing extension was loaded.'
    }
    Invoke-TestCase 'All maintenance skip options preserve their saved values' {
        Reset-Records
        $settings = New-TestSettings
        foreach ($name in @('SkipPreferences', 'SkipShortcuts', 'SkipUrlHandlers', 'SkipAutoStart', 'NoAutoRepair')) { $settings[$name] = $true }
        Write-TestSettings $settings
        Invoke-TestRunner -RepairOnly
        $maintenance = Read-Record 'maintenance-call.json'
        foreach ($name in @('SkipPreferences', 'SkipShortcuts', 'SkipUrlHandlers', 'SkipAutoStart', 'NoAutoRepair')) { Assert-Equal $maintenance.$name $true }
    }
    Invoke-TestCase 'An existing PreferredNeoExe is supplied as an explicit override' {
        Reset-Records
        $settings = New-TestSettings
        $settings.PreferredNeoExe = $preferredExe
        Write-TestSettings $settings
        Invoke-TestRunner
        $resolution = Read-Record 'resolve-call.json'
        Assert-Equal $resolution.ExplicitPath $preferredExe
        Assert-True ($resolution.BoundNames -contains 'ExplicitPath') 'Preferred path was not explicit.'
        Assert-Equal (Read-Record 'launch-call.json').FilePath $preferredExe
    }
    Invoke-TestCase 'A disappeared PreferredNeoExe falls back to dynamic discovery' {
        Reset-Records
        $settings = Read-Record 'settings.json'
        Remove-Item -LiteralPath $preferredExe -Force
        Invoke-TestRunner
        $resolution = Read-Record 'resolve-call.json'
        Assert-True ($resolution.BoundNames -notcontains 'ExplicitPath') 'Missing preferred executable was forced.'
        Assert-Equal $resolution.HintPath $settings.NeoExeHint
        Assert-Equal ($resolution.ShortcutRoots -join '|') ($settings.ShortcutRoots -join '|')
        Assert-Equal ($resolution.ProgIds -join '|') ($settings.ProgIds -join '|')
        Assert-Equal (Read-Record 'launch-call.json').FilePath $currentExe
    }
    Invoke-TestCase 'Chinese URL containing spaces reaches Neo as one quoted argument' {
        Reset-Records
        $settings = New-TestSettings
        Write-TestSettings $settings
        $url = 'https://example.org/中文 路径?q=你好 世界&mode=1'
        Invoke-TestRunner -Url $url
        $arguments = (Read-Record 'launch-call.json').ArgumentList
        Assert-True ($arguments.EndsWith(' --single-argument "' + $url + '"')) 'URL text or single-argument quoting changed.'
    }
    Invoke-TestCase 'URL containing a quote is rejected without starting Neo' {
        Reset-Records
        Invoke-TestRunner -Url 'https://example.org/" --unexpected-switch'
        Assert-Equal $script:RunnerExitCode 1
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $deployed 'launch-call.json'))) 'Quoted URL launched Neo.'
        Assert-True ((Get-Content -LiteralPath (Join-Path $deployed 'last-repair.log') -Raw).Contains('网址包含无效字符')) 'Invalid URL did not produce the expected repair log.'
        Assert-True (Test-Path -LiteralPath (Join-Path $deployed 'com-denied.log')) 'Error reporting did not use the intercepted COM branch.'
    }
    Invoke-TestCase 'URL containing a newline is rejected without starting Neo' {
        Reset-Records
        Invoke-TestRunner -Url "https://example.org/one`ntwo"
        Assert-Equal $script:RunnerExitCode 1
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $deployed 'launch-call.json'))) 'Newline URL launched Neo.'
    }
    Invoke-TestCase 'RepairOnly ignores a URL and still never launches Neo' {
        Reset-Records
        Invoke-TestRunner -RepairOnly -Url 'https://example.org/中文 空格'
        Assert-Equal $script:RunnerExitCode 0
        Assert-True (Test-Path -LiteralPath (Join-Path $deployed 'maintenance-call.json')) 'RepairOnly skipped maintenance.'
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $deployed 'launch-call.json'))) 'RepairOnly plus URL launched Neo.'
    }
    Invoke-TestCase 'A later invocation uses a newly discovered executable' {
        Reset-Records
        $nextExe = New-EmptyFixture '更新后 Neo\neo.exe'
        [IO.File]::WriteAllText((Join-Path $deployed 'current-exe.txt'), $nextExe)
        Remove-Item -LiteralPath $currentExe -Force
        Invoke-TestRunner
        Assert-Equal (Read-Record 'maintenance-call.json').NeoExe $nextExe
        Assert-Equal (Read-Record 'launch-call.json').FilePath $nextExe
    }
    Invoke-TestCase 'Unowned settings are rejected before discovery or maintenance' {
        Reset-Records
        $settings = New-TestSettings
        $settings.Owner = 'DifferentApplication'
        Write-TestSettings $settings
        Invoke-TestRunner -RepairOnly
        Assert-Equal $script:RunnerExitCode 1
        foreach ($name in @('resolve-call.json', 'maintenance-call.json', 'launch-call.json', 'com-denied.log')) {
            Assert-True (-not (Test-Path -LiteralPath (Join-Path $deployed $name))) "Unexpected operation for unowned settings: $name"
        }
    }
    Invoke-TestCase 'Unsupported settings schema is rejected before discovery' {
        Reset-Records
        $settings = New-TestSettings
        $settings.SchemaVersion = 999
        Write-TestSettings $settings
        Invoke-TestRunner -RepairOnly
        Assert-Equal $script:RunnerExitCode 1
        Assert-True (-not (Test-Path -LiteralPath (Join-Path $deployed 'resolve-call.json'))) 'Unsupported schema reached discovery.'
    }
} finally {
    [Environment]::SetEnvironmentVariable('NEO_TOOLBAR_RUNTIME_TEST_ROOT', $savedTestEnvironment, 'Process')
    if ($hadExitCodeVariable) { $global:LASTEXITCODE = $savedExitCode }
    else { Remove-Variable -Name LASTEXITCODE -Scope Global -ErrorAction SilentlyContinue }
    # Check the exact absolute GUID-named child before recursive cleanup.
    $cleanupPath = [IO.Path]::GetFullPath($testRoot).TrimEnd('\', '/')
    $expectedPath = [IO.Path]::GetFullPath((Join-Path $tempBase $testName)).TrimEnd('\', '/')
    $tempPrefix = $tempBase + [IO.Path]::DirectorySeparatorChar
    if ($cleanupPath -ne $expectedPath -or
        -not $cleanupPath.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($cleanupPath) -ne $testName) {
        throw "Refusing cleanup outside temporary test directory: $cleanupPath"
    }
    if (Test-Path -LiteralPath $cleanupPath -PathType Container) { Remove-Item -LiteralPath $cleanupPath -Recurse -Force }
}

Write-Host "PASS: $script:Passed deployed Neo runtime tests. No browser launched; temporary fixtures removed."
