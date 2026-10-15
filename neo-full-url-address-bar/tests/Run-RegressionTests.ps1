#Requires -Version 7.2
<#
.SYNOPSIS
    Self-contained regression tests. No Pester and no real Neo configuration changes.
.EXAMPLE
    pwsh -NoProfile -File .\neo-full-url-address-bar\tests\Run-RegressionTests.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$script:Passed = 0
$script:Failed = 0
$script:MainScript = Join-Path (Split-Path $PSScriptRoot) 'Set-NeoFullUrlAddressBar.ps1'
$global:NeoToolbarTestCimProcesses = @()
$script:FixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('NeoToolbarTests-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($script:FixtureRoot)
$global:NeoToolbarTestFixtureRoot = $script:FixtureRoot
$global:NeoToolbarTestLinks = @{}
$global:NeoToolbarTestAllowShortcutSave = $false
$global:NeoToolbarTestShortcutSaveCount = 0

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Assert-Equal($Expected, $Actual, [string]$Message) {
    if ($Expected -cne $Actual) {
        throw "$Message`nExpected: $Expected`nActual:   $Actual"
    }
}

function Assert-Contains([string]$Text, [string]$Expected, [string]$Message) {
    Assert-True ($Text.Contains($Expected, [StringComparison]::Ordinal)) $Message
}

function Run-Test([string]$Name, [scriptblock]$Body) {
    try {
        & $Body
        $script:Passed++
        Write-Host "PASS $Name" -ForegroundColor Green
    }
    catch {
        $script:Failed++
        Write-Host "FAIL $Name`n$($_.Exception.Message)" -ForegroundColor Red
    }
}

function New-FixtureDirectory([string]$Name) {
    $path = Join-Path $script:FixtureRoot $Name
    [void][IO.Directory]::CreateDirectory($path)
    $path
}

function Set-TestConfiguration([string]$Directory, [switch]$UndoMode) {
    $script:Undo = [bool]$UndoMode
    $script:UserDataDir = $Directory
    $script:Changed = 0
    $script:WantZoom = -not $UndoMode
    $script:ZoomExtensionId = 'pfoejdcoooobifjhbnemjanhjlkkgbea'
    $script:BackupSuffix = '.before-neo-full-url.bak'
    $script:PrefSettings = [ordered]@{
        'omnibox.prevent_url_elisions' = $true
        'navigator.omnibox.use_full_width' = $true
        'navigator.omnibox.show_title' = $false
    }
    $script:FeaturesOn = if ($UndoMode) { @() } else { @('NavigatorReadOnlyOmnibox', 'NeoVerticalTabs') }
    $script:FeaturesOff = if ($UndoMode) { @('NavigatorReadOnlyOmnibox', 'NeoVerticalTabs') } else { @() }
    $script:ExtensionDir = Join-Path $script:FixtureRoot 'Extension With Spaces\zoom-controls'
    $script:ExtensionsOn = if ($UndoMode) { @() } else { @($script:ExtensionDir) }
    $script:ExtensionsOff = if ($UndoMode) { @($script:ExtensionDir) } else { @() }
}

function Invoke-TestPreferenceUpdate {
    [CmdletBinding(SupportsShouldProcess)]
    param()
    Update-Preferences
}

function Invoke-TestManagedShortcutUpdate {
    [CmdletBinding(SupportsShouldProcess)]
    param([string]$Path, [string]$Runner, [string]$PwshExe, [switch]$RepairOnly, [switch]$Remove)
    Update-NeoManagedShortcut @PSBoundParameters
}

function Write-TestInstalledSettings([string]$StateDirectory, [string]$DataDirectory, [string]$ExtensionsDirectory, [string]$DeletedExecutable) {
    [void][IO.Directory]::CreateDirectory($StateDirectory)
    $settings = [ordered]@{
        Owner = 'NeoFullUrlAddressBar'
        SchemaVersion = 1
        NeoExeHint = $DeletedExecutable
        PreferredNeoExe = $DeletedExecutable
        UserDataDir = $DataDirectory
        ExtensionDir = $ExtensionsDirectory
        StateDir = $StateDirectory
        ShortcutRoots = @()
        ProgIds = @()
    }
    [IO.File]::WriteAllText((Join-Path $StateDirectory 'settings.json'), ($settings | ConvertTo-Json -Depth 5))
}

function Get-DirectorySnapshot([string]$Directory) {
    @(
        Get-ChildItem -LiteralPath $Directory -Recurse -Force | Sort-Object FullName | ForEach-Object {
            $relative = [IO.Path]::GetRelativePath($Directory, $_.FullName)
            if ($_.PSIsContainer) { "D $relative" }
            else { "F $relative $((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash) $($_.LastWriteTimeUtc.Ticks)" }
        }
    ) -join "`n"
}

# The isolated installer fixture has no running browser. Avoid accessing the
# machine's real process list (and keep tests runnable inside restricted CI).
function Get-CimInstance {
    [CmdletBinding()]
    param([string]$ClassName, [string]$Filter)
    if ($ClassName -ne 'Win32_Process') { throw "Unexpected CIM access in a fixture: $ClassName" }
    $global:NeoToolbarTestCimProcesses
}

# No real shortcut is opened, including a same-named existing Start-menu entry.
# Saving is normally forbidden. Only dedicated temporary-link tests opt in.
function New-Object {
    [CmdletBinding()]
    param([string]$ComObject)
    if ($ComObject -ne 'WScript.Shell') { throw "Unexpected object construction in a fixture: $ComObject" }
    $shell = [pscustomobject]@{}
    $shell | Add-Member -MemberType ScriptMethod -Name CreateShortcut -Value {
        param($Path)
        $normalized = [IO.Path]::GetFullPath($Path)
        if ($global:NeoToolbarTestLinks.ContainsKey($normalized)) { return $global:NeoToolbarTestLinks[$normalized] }
        $link = [pscustomobject]@{
            TestPath = $normalized
            TargetPath = ''
            Arguments = ''
            WorkingDirectory = ''
            IconLocation = ''
            Description = ''
            WindowStyle = 1
        }
        $link | Add-Member -MemberType ScriptMethod -Name Save -Value {
            $allowedRoot = [IO.Path]::GetFullPath($global:NeoToolbarTestFixtureRoot).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
            if (-not $global:NeoToolbarTestAllowShortcutSave -or
                -not $this.TestPath.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) {
                throw 'A real shortcut write was attempted outside an opted-in temporary fixture.'
            }
            $global:NeoToolbarTestShortcutSaveCount++
            $global:NeoToolbarTestLinks[$this.TestPath] = $this
            [IO.File]::WriteAllText($this.TestPath, 'In-memory test shortcut placeholder; not a real Windows shortcut.')
        }
        $link
    }
    $shell
}

function Start-Process { throw 'A regression test attempted to launch a real process.' }
function Stop-Process { throw 'A regression test attempted to stop a real process.' }

try {
    # Load only function definitions. The installer's top-level code never runs here.
    $functionSources = @(
        (Join-Path (Split-Path $PSScriptRoot) 'NeoPaths.ps1'),
        (Join-Path (Split-Path $PSScriptRoot) 'NeoPersistence.ps1'),
        $script:MainScript
    )
    foreach ($source in $functionSources | Where-Object { Test-Path -LiteralPath $_ }) {
        $parseTokens = $null
        $parseErrors = $null
        $ast = [Management.Automation.Language.Parser]::ParseFile($source, [ref]$parseTokens, [ref]$parseErrors)
        if ($parseErrors.Count) { throw "Script syntax errors in ${source}: $($parseErrors.Message -join '; ')" }
        foreach ($definition in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
            . ([scriptblock]::Create($definition.Extent.Text))
        }
    }

    Run-Test 'Switch lists merge user features and remain idempotent' {
        $arguments = '--profile-directory="Profile 2" --disable-features=UserFeatureA,UserFeatureB --new-window'
        $once = Edit-SwitchList $arguments 'disable-features' @('NavigatorReadOnlyOmnibox', 'NeoVerticalTabs') @()
        $twice = Edit-SwitchList $once 'disable-features' @('NavigatorReadOnlyOmnibox', 'NeoVerticalTabs') @()
        Assert-Equal $once $twice 'Reapplying changed the command.'
        Assert-Contains $once '--disable-features=UserFeatureA,UserFeatureB,NavigatorReadOnlyOmnibox,NeoVerticalTabs' 'User features were lost.'
        Assert-Contains $once '--profile-directory="Profile 2"' 'The profile argument was lost.'
        Assert-Contains $once '--new-window' 'An unrelated argument was lost.'
    }

    Run-Test 'Switch removal keeps unrelated values and handles case and trailing separators' {
        $arguments = '--load-extension="C:\Other Extension,C:\Toolbar Tweaks\zoom-controls\" --new-window'
        $actual = Edit-SwitchList $arguments 'load-extension' @() @('c:\toolbar tweaks\ZOOM-controls')
        Assert-Equal '--load-extension="C:\Other Extension" --new-window' $actual 'Removal lost or retained an unexpected extension.'
        $empty = Edit-SwitchList '--new-window --disable-features=NeoVerticalTabs' 'disable-features' @() @('NeoVerticalTabs')
        Assert-Equal '--new-window' $empty 'The empty switch was not removed.'
    }

    Run-Test 'Extension paths containing spaces are quoted and not duplicated' {
        Set-TestConfiguration $script:FixtureRoot
        $arguments = '--load-extension="C:\User Extension" --profile-directory="Profile 1"'
        $actual = Edit-NeoSwitches $arguments
        Assert-Contains $actual ('--load-extension="C:\User Extension,' + $script:ExtensionDir + '"') 'Space-containing paths were not retained in a quoted switch.'
        Assert-Equal $actual (Edit-NeoSwitches $actual) 'Reapplying duplicated a switch or extension.'
    }

    Run-Test 'New switches are inserted before the URL single-argument marker' {
        Set-TestConfiguration $script:FixtureRoot
        $arguments = '"C:\Neo Browser\Application\neo.exe" --profile-directory="Profile 1" --single-argument "%1"'
        $actual = Edit-NeoSwitches $arguments
        $marker = $actual.IndexOf('--single-argument', [StringComparison]::Ordinal)
        Assert-True ($actual.IndexOf('--disable-features=', [StringComparison]::Ordinal) -lt $marker) 'Feature switch was placed inside the URL argument.'
        Assert-True ($actual.IndexOf('--load-extension=', [StringComparison]::Ordinal) -lt $marker) 'Extension switch was placed inside the URL argument.'
        Assert-True ($actual.EndsWith('--single-argument "%1"', [StringComparison]::Ordinal)) 'URL placeholder was altered.'
    }

    Run-Test 'Text after single-argument is kept verbatim even when it resembles a switch' {
        Set-TestConfiguration $script:FixtureRoot
        $urlTail = '--single-argument "https://example.invalid/?q= --disable-features=URLText"'
        $actual = Edit-NeoSwitches ('--profile-directory="Profile 1" ' + $urlTail)
        Assert-True ($actual.EndsWith($urlTail, [StringComparison]::Ordinal)) 'URL content was parsed as browser switches.'
        $marker = $actual.IndexOf('--single-argument', [StringComparison]::Ordinal)
        Assert-True ($actual.IndexOf('--disable-features=NavigatorReadOnlyOmnibox', [StringComparison]::Ordinal) -lt $marker) 'The effective feature switch was not added before the URL.'
    }

    Run-Test 'Undo removes only managed switches and keeps user arguments' {
        Set-TestConfiguration $script:FixtureRoot
        $original = '--profile-directory="Profile 3" --disable-features=UserFeature --load-extension="C:\Other Extension" --single-argument "%1"'
        $applied = Edit-NeoSwitches $original
        Set-TestConfiguration $script:FixtureRoot -UndoMode
        $undone = Edit-NeoSwitches $applied
        Assert-Equal $original $undone 'Undo did not preserve the original user arguments.'
        Assert-Equal $undone (Edit-NeoSwitches $undone) 'Undo was not idempotent.'
    }

    Run-Test 'Repeated switch occurrences are merged into one effective switch' {
        $arguments = '--disable-features=UserFeatureA --new-window --disable-features=UserFeatureB'
        $actual = Edit-SwitchList $arguments 'disable-features' @('NavigatorReadOnlyOmnibox') @()
        Assert-Equal 1 ([regex]::Matches($actual, '--disable-features=').Count) 'Chromium would use a later unmodified switch.'
        Assert-Contains $actual 'UserFeatureA' 'First user feature was lost.'
        Assert-Contains $actual 'UserFeatureB' 'Last user feature was lost.'
        Assert-Contains $actual 'NavigatorReadOnlyOmnibox' 'Managed feature was lost.'
    }

    Run-Test 'Neo command repair follows the current executable path and preserves user arguments' {
        Set-TestConfiguration $script:FixtureRoot
        $script:NeoExe = Join-Path $script:FixtureRoot 'Neo New Location\Application\neo.exe'
        $arguments = '"C:\Old Neo Location\Application\neo.exe" --profile-directory="Profile 4" --new-window --single-argument "%1"'
        $actual = Edit-NeoCommandLine $arguments
        Assert-True ($actual.StartsWith('"' + $script:NeoExe + '" ', [StringComparison]::Ordinal)) 'The stale executable path was not replaced.'
        Assert-Contains $actual '--profile-directory="Profile 4"' 'Command repair lost the selected profile.'
        Assert-Contains $actual '--new-window' 'Command repair lost a user switch.'
        Assert-True ($actual.EndsWith('--single-argument "%1"', [StringComparison]::Ordinal)) 'Command repair altered the URL placeholder.'
        Assert-Equal $actual (Edit-NeoCommandLine $actual) 'Command repair was not idempotent.'
    }

    Run-Test 'Neo command repair does not rewrite unrelated applications' {
        Set-TestConfiguration $script:FixtureRoot
        $script:NeoExe = Join-Path $script:FixtureRoot 'Neo Current\neo.exe'
        foreach ($command in @('"C:\Other Browser\Application\browser.exe" --single-argument "%1"', '"C:\Scripts\neo.exe.helper.cmd" --new-window')) {
            Assert-Equal $command (Edit-NeoCommandLine $command) 'An unrelated application command was changed.'
        }
    }

    Run-Test 'Neo command repair keeps environment variables inside user arguments' {
        Set-TestConfiguration $script:FixtureRoot
        $script:NeoExe = Join-Path $script:FixtureRoot 'New Install\neo.exe'
        $command = '"C:\Old Install For Regression\neo.exe" --user-data-dir="%LOCALAPPDATA%\Custom Neo Profile" --profile-directory="Profile 6" --disable-features=UserFeature --single-argument "%1"'
        $actual = Edit-NeoCommandLine $command
        Assert-Contains $actual '--user-data-dir="%LOCALAPPDATA%\Custom Neo Profile"' 'A user argument environment variable was expanded or lost.'
        Assert-Contains $actual '--profile-directory="Profile 6"' 'The profile argument was lost.'
        Assert-True ($actual.EndsWith('--single-argument "%1"', [StringComparison]::Ordinal)) 'The shell URL placeholder was expanded or altered.'
    }

    Run-Test 'Neo command repair preserves a different valid Neo installation' {
        Set-TestConfiguration $script:FixtureRoot
        $script:NeoExe = Join-Path $script:FixtureRoot 'Primary Install\neo.exe'
        $alternate = Join-Path (New-FixtureDirectory 'Alternate Install') 'neo.exe'
        [IO.File]::WriteAllText($alternate, 'valid path fixture, never executed')
        $command = '"' + $alternate + '" --profile-directory="Profile 7" --single-argument "%1"'
        Assert-Equal $command (Edit-NeoCommandLine $command) 'A separate existing Neo installation was redirected or modified.'
    }

    Run-Test 'Managed shortcuts are created and remain unchanged when reapplied' {
        $fixture = New-FixtureDirectory 'ManagedShortcut'
        $path = Join-Path $fixture 'Neo toolbar.lnk'
        $runner = Join-Path $fixture 'Installed Runtime\Invoke-NeoToolbar.ps1'
        $pwshExe = Join-Path $fixture 'PowerShell 7\pwsh.exe'
        Set-TestConfiguration $fixture
        $script:NeoExe = Join-Path $fixture 'Neo Application\neo.exe'
        $global:NeoToolbarTestAllowShortcutSave = $true
        try {
            $before = $global:NeoToolbarTestShortcutSaveCount
            Invoke-TestManagedShortcutUpdate -Path $path -Runner $runner -PwshExe $pwshExe
            Assert-True (Test-Path -LiteralPath $path -PathType Leaf) 'The managed shortcut was not saved.'
            Assert-Equal ($before + 1) $global:NeoToolbarTestShortcutSaveCount 'Creation did not save exactly once.'
            $link = $global:NeoToolbarTestLinks[[IO.Path]::GetFullPath($path)]
            Assert-Equal $pwshExe $link.TargetPath 'The launcher does not target PowerShell.'
            Assert-Contains $link.Arguments ('-File "' + $runner + '"') 'The installed runner path was not quoted.'
            Assert-Equal "$($script:NeoExe),0" $link.IconLocation 'The browser icon was not configured.'
            $script:Changed = 0
            $snapshot = Get-DirectorySnapshot $fixture
            Invoke-TestManagedShortcutUpdate -Path $path -Runner $runner -PwshExe $pwshExe
            Assert-Equal 0 $script:Changed 'Reapplying reported a shortcut change.'
            Assert-Equal ($before + 1) $global:NeoToolbarTestShortcutSaveCount 'Reapplying saved the unchanged shortcut.'
            Assert-Equal $snapshot (Get-DirectorySnapshot $fixture) 'Reapplying rewrote the shortcut fixture.'
        }
        finally { $global:NeoToolbarTestAllowShortcutSave = $false }
    }

    Run-Test 'Disabling automatic repair removes only its owned repair shortcut' {
        $fixture = New-FixtureDirectory 'RepairShortcut'
        $path = Join-Path $fixture 'Neo auto repair.lnk'
        $runner = Join-Path $fixture 'Runtime\Invoke-NeoToolbar.ps1'
        Set-TestConfiguration $fixture
        $script:NeoExe = Join-Path $fixture 'neo.exe'
        $global:NeoToolbarTestAllowShortcutSave = $true
        try {
            Invoke-TestManagedShortcutUpdate -Path $path -Runner $runner -PwshExe (Join-Path $fixture 'pwsh.exe') -RepairOnly
            $link = $global:NeoToolbarTestLinks[[IO.Path]::GetFullPath($path)]
            Assert-Contains $link.Arguments ' -RepairOnly' 'The sign-in entry would launch Neo instead of only repairing.'
            Invoke-TestManagedShortcutUpdate -Path $path -Runner $runner -PwshExe (Join-Path $fixture 'pwsh.exe') -RepairOnly -Remove
            Assert-True (-not (Test-Path -LiteralPath $path)) 'The owned automatic-repair shortcut was not removed.'
        }
        finally { $global:NeoToolbarTestAllowShortcutSave = $false }
    }

    Run-Test 'A same-named shortcut owned by another application is preserved on apply and Undo' {
        $fixture = New-FixtureDirectory 'UnrelatedShortcut'
        $path = Join-Path $fixture 'Neo toolbar.lnk'
        $runner = Join-Path $fixture 'Runtime\Invoke-NeoToolbar.ps1'
        [IO.File]::WriteAllText($path, 'another application owns this shortcut')
        $shell = New-Object -ComObject WScript.Shell
        $link = $shell.CreateShortcut($path)
        $link.TargetPath = 'C:\Other App\app.exe'
        $link.Arguments = '--unrelated'
        $global:NeoToolbarTestLinks[[IO.Path]::GetFullPath($path)] = $link
        Set-TestConfiguration $fixture
        $script:NeoExe = Join-Path $fixture 'neo.exe'
        $before = Get-DirectorySnapshot $fixture
        Invoke-TestManagedShortcutUpdate -Path $path -Runner $runner -PwshExe (Join-Path $fixture 'pwsh.exe')
        Invoke-TestManagedShortcutUpdate -Path $path -Runner $runner -PwshExe (Join-Path $fixture 'pwsh.exe') -Remove
        Assert-Equal $before (Get-DirectorySnapshot $fixture) 'A same-named unrelated shortcut was overwritten or deleted.'
        Assert-Equal '--unrelated' $link.Arguments 'The unrelated shortcut object was modified.'
    }

    Run-Test 'Shortcut ownership works when the installed runner path contains brackets and parentheses' {
        $fixture = New-FixtureDirectory 'Runtime [Portable] (Neo)'
        $path = Join-Path $fixture 'Neo toolbar.lnk'
        $runner = Join-Path $fixture 'Runtime [Version 1] (Local)\Invoke-NeoToolbar.ps1'
        $pwshExe = Join-Path $fixture 'pwsh.exe'
        Set-TestConfiguration $fixture
        $script:NeoExe = Join-Path $fixture 'neo.exe'
        $global:NeoToolbarTestAllowShortcutSave = $true
        try {
            Invoke-TestManagedShortcutUpdate -Path $path -Runner $runner -PwshExe $pwshExe
            $script:Changed = 0
            Invoke-TestManagedShortcutUpdate -Path $path -Runner $runner -PwshExe $pwshExe
            Assert-Equal 0 $script:Changed 'Bracket-containing ownership was not recognized on reapply.'
            Invoke-TestManagedShortcutUpdate -Path $path -Runner $runner -PwshExe $pwshExe -Remove
            Assert-True (-not (Test-Path -LiteralPath $path)) 'Bracket-containing owned shortcut was treated as another application.'
        }
        finally { $global:NeoToolbarTestAllowShortcutSave = $false }
    }

    Run-Test 'Preferences update all normal profiles and existing account pin lists without changing unrelated JSON values' {
        $data = New-FixtureDirectory 'Preferences'
        $original = '{"omnibox":{"other":"keep"},"navigator":{"unrelated":7},"extensions":{"pinned_extensions":["user-extension"]},"account_values":{"extensions":{"pinned_extensions":["account-extension"]}},"big":9007199254740993,"decimal":1.230000,"exponent":1e+09,"date":"2026-10-15T00:00:00Z","numeric":"00123","unicode":"中文保持"}'
        foreach ($profile in @('Default', 'Profile 1')) {
            $path = Join-Path (New-FixtureDirectory "Preferences\$profile") 'Preferences'
            [IO.File]::WriteAllText($path, $original)
        }
        $guest = Join-Path (New-FixtureDirectory 'Preferences\Guest Profile') 'Preferences'
        [IO.File]::WriteAllText($guest, 'not a JSON file; must be ignored')
        Set-TestConfiguration $data
        Invoke-TestPreferenceUpdate
        Assert-Equal 2 $script:Changed 'Not all initialized normal profiles were updated.'
        foreach ($profile in @('Default', 'Profile 1')) {
            $path = Join-Path $data "$profile\Preferences"
            $raw = [IO.File]::ReadAllText($path)
            $json = [Text.Json.Nodes.JsonNode]::Parse($raw)
            Assert-Equal 'true' ($json['omnibox']['prevent_url_elisions'].ToJsonString()) 'Full URL setting was not applied.'
            Assert-Equal 'true' ($json['navigator']['omnibox']['use_full_width'].ToJsonString()) 'Full width setting was not applied.'
            Assert-Equal 'false' ($json['navigator']['omnibox']['show_title'].ToJsonString()) 'Page title setting was not applied.'
            Assert-Equal $script:ZoomExtensionId ([string]$json['extensions']['pinned_extensions'][0]) 'Local zoom button was not pinned first.'
            Assert-Equal 'user-extension' ([string]$json['extensions']['pinned_extensions'][1]) 'Local user pin was lost.'
            Assert-Equal $script:ZoomExtensionId ([string]$json['account_values']['extensions']['pinned_extensions'][0]) 'Account zoom button was not pinned first.'
            Assert-Equal 'account-extension' ([string]$json['account_values']['extensions']['pinned_extensions'][1]) 'Account user pin was lost.'
            foreach ($fragment in @('"big":9007199254740993', '"decimal":1.230000', '"exponent":1e+09', '"date":"2026-10-15T00:00:00Z"', '"numeric":"00123"', '"unicode":"中文保持"')) {
                Assert-Contains $raw $fragment "Unrelated JSON value changed: $fragment"
            }
            Assert-Equal $original ([IO.File]::ReadAllText($path + $script:BackupSuffix)) 'The original backup was not preserved.'
        }
        Assert-Equal 'not a JSON file; must be ignored' ([IO.File]::ReadAllText($guest)) 'Guest Profile was changed.'
        $before = Get-DirectorySnapshot $data
        $script:Changed = 0
        Invoke-TestPreferenceUpdate
        Assert-Equal 0 $script:Changed 'Preferences application was not idempotent.'
        Assert-Equal $before (Get-DirectorySnapshot $data) 'Idempotent application still wrote a file.'
    }

    Run-Test 'Preferences Undo removes every managed pin and preserves unrelated fields' {
        $data = New-FixtureDirectory 'UndoPreferences'
        $path = Join-Path (New-FixtureDirectory 'UndoPreferences\Default') 'Preferences'
        $zoom = 'pfoejdcoooobifjhbnemjanhjlkkgbea'
        $original = '{"omnibox":{"prevent_url_elisions":true,"other":"keep"},"navigator":{"omnibox":{"use_full_width":true,"show_title":false,"other":42}},"extensions":{"pinned_extensions":["' + $zoom + '","keep","' + $zoom + '"]},"account_values":{"extensions":{"pinned_extensions":["keep-account","' + $zoom + '"]}}}'
        [IO.File]::WriteAllText($path, $original)
        Set-TestConfiguration $data -UndoMode
        Invoke-TestPreferenceUpdate
        $json = [Text.Json.Nodes.JsonNode]::Parse([IO.File]::ReadAllText($path))
        Assert-True ($null -eq $json['omnibox']['prevent_url_elisions']) 'Undo left the managed full URL preference.'
        Assert-True ($null -eq $json['navigator']['omnibox']['use_full_width']) 'Undo left the managed width preference.'
        Assert-True ($null -eq $json['navigator']['omnibox']['show_title']) 'Undo left the managed title preference.'
        Assert-Equal 'keep' ([string]$json['omnibox']['other']) 'Undo removed an unrelated preference.'
        Assert-Equal '42' ($json['navigator']['omnibox']['other'].ToJsonString()) 'Undo changed an unrelated number.'
        Assert-Equal '["keep"]' ($json['extensions']['pinned_extensions'].ToJsonString()) 'Undo did not preserve local user pins.'
        Assert-Equal '["keep-account"]' ($json['account_values']['extensions']['pinned_extensions'].ToJsonString()) 'Undo did not preserve account user pins.'
    }

    Run-Test 'Preferences do not create missing account-level pin lists' {
        $data = New-FixtureDirectory 'AccountPreferences'
        $path = Join-Path (New-FixtureDirectory 'AccountPreferences\Default') 'Preferences'
        [IO.File]::WriteAllText($path, '{"account_values":{"unrelated":true}}')
        Set-TestConfiguration $data
        Invoke-TestPreferenceUpdate
        $json = [Text.Json.Nodes.JsonNode]::Parse([IO.File]::ReadAllText($path))
        Assert-True ($null -eq $json['account_values']['extensions']) 'A nonexistent synced pin list was created.'
        Assert-Equal 'true' ($json['account_values']['unrelated'].ToJsonString()) 'An unrelated account preference was altered.'
    }

    Run-Test 'Preferences WhatIf leaves file bytes, timestamps and backup state unchanged' {
        $data = New-FixtureDirectory 'WhatIfPreferences'
        $path = Join-Path (New-FixtureDirectory 'WhatIfPreferences\Default') 'Preferences'
        [IO.File]::WriteAllText($path, '{"unrelated":"keep"}')
        Set-TestConfiguration $data
        $before = Get-DirectorySnapshot $data
        Invoke-TestPreferenceUpdate -WhatIf
        Assert-Equal $before (Get-DirectorySnapshot $data) 'WhatIf changed profile data or created a backup.'
        Assert-Equal 0 $script:Changed 'WhatIf recorded a committed change.'
    }

    Run-Test 'Whole-script WhatIf leaves an isolated install fixture unchanged' {
        $fixture = New-FixtureDirectory 'WhatIfInstaller'
        $fakeExe = Join-Path $fixture 'Neo Application\neo.exe'
        [void][IO.Directory]::CreateDirectory((Split-Path $fakeExe))
        [IO.File]::WriteAllText($fakeExe, 'test fixture, never executed')
        $data = Join-Path $fixture 'User Data'
        [void][IO.Directory]::CreateDirectory((Join-Path $data 'Default'))
        [IO.File]::WriteAllText((Join-Path $data 'Default\Preferences'), '{"unrelated":"keep"}')
        $before = Get-DirectorySnapshot $fixture
        & $script:MainScript -NeoExe $fakeExe -UserDataDir $data -StateDir (Join-Path $fixture 'Maintenance State') -ExtensionDir (Join-Path $fixture 'Extensions With Spaces\zoom-controls') -SkipShortcuts -SkipUrlHandlers -SkipAutoStart -WhatIf
        Assert-Equal $before (Get-DirectorySnapshot $fixture) 'Whole-script WhatIf changed an installer fixture.'
    }

    Run-Test 'Maintenance always leaves profiles alone, regardless of current browser process state' {
        $fixture = New-FixtureDirectory 'RunningMaintenance'
        $fakeExe = Join-Path $fixture 'Neo Application\neo.exe'
        [void][IO.Directory]::CreateDirectory((Split-Path $fakeExe))
        [IO.File]::WriteAllText($fakeExe, 'test fixture, never executed')
        $data = Join-Path $fixture 'User Data'
        [void][IO.Directory]::CreateDirectory((Join-Path $data 'Default'))
        [IO.File]::WriteAllText((Join-Path $data 'Default\Preferences'), '{"unrelated":"keep"}')
        try {
            $before = Get-DirectorySnapshot $fixture
            foreach ($running in @($false, $true)) {
                $global:NeoToolbarTestCimProcesses = if ($running) {
                    @([pscustomobject]@{ Name = 'neo.exe'; CommandLine = ('"' + $fakeExe + '" --user-data-dir="' + $data + '"') })
                } else { @() }
                $output = (& $script:MainScript -NeoExe $fakeExe -UserDataDir $data -StateDir (Join-Path $fixture 'State') -ExtensionDir (Join-Path $fixture 'Extension') -SkipShortcuts -SkipUrlHandlers -SkipAutoStart -Maintenance -WhatIf *>&1 | Out-String)
                Assert-True (-not $output.Contains('Profile 偏好（Preferences）', [StringComparison]::Ordinal)) "Maintenance attempted a profile update (Running=$running)."
                Assert-Equal $before (Get-DirectorySnapshot $fixture) "Maintenance preview changed files (Running=$running)."
            }
        }
        finally { $global:NeoToolbarTestCimProcesses = @() }
    }

    Run-Test 'Normal installation refuses a running profile before writing any files' {
        $fixture = New-FixtureDirectory 'RunningInstall'
        $fakeExe = Join-Path $fixture 'neo.exe'
        [IO.File]::WriteAllText($fakeExe, 'test fixture, never executed')
        $data = Join-Path $fixture 'User Data'
        [void][IO.Directory]::CreateDirectory((Join-Path $data 'Default'))
        [IO.File]::WriteAllText((Join-Path $data 'Default\Preferences'), '{"unrelated":"keep"}')
        $global:NeoToolbarTestCimProcesses = @([pscustomobject]@{
            Name = 'neo.exe'
            CommandLine = ('"' + $fakeExe + '" --user-data-dir="' + $data + '"')
        })
        try {
            $before = Get-DirectorySnapshot $fixture
            $failure = $null
            try {
                & $script:MainScript -NeoExe $fakeExe -UserDataDir $data -StateDir (Join-Path $fixture 'State') -ExtensionDir (Join-Path $fixture 'Extension') -SkipShortcuts -SkipUrlHandlers -SkipAutoStart
            }
            catch { $failure = $_.Exception.Message }
            Assert-True ($null -ne $failure) 'Normal installation continued while the fixture browser was running.'
            Assert-Contains $failure 'Neo 仍在运行' 'Installation failed for an unexpected reason.'
            Assert-Equal $before (Get-DirectorySnapshot $fixture) 'Installation wrote files before detecting the running profile.'
        }
        finally { $global:NeoToolbarTestCimProcesses = @() }
    }

    Run-Test 'Whole-script Undo uses saved custom directories after the portable browser is removed' {
        $fixture = New-FixtureDirectory 'SavedSettingsUndo'
        $state = Join-Path $fixture 'Custom Maintenance State'
        $data = Join-Path $fixture 'Custom Profile Data'
        $extensions = Join-Path $fixture 'Custom Extension Deployment\zoom-controls'
        $deletedExe = Join-Path $fixture 'Deleted Portable Browser\neo.exe'
        [void][IO.Directory]::CreateDirectory((Join-Path $data 'Default'))
        [void][IO.Directory]::CreateDirectory($extensions)
        $preferences = Join-Path $data 'Default\Preferences'
        [IO.File]::WriteAllText($preferences, '{"omnibox":{"prevent_url_elisions":true,"other":"keep"},"navigator":{"omnibox":{"use_full_width":true,"show_title":false}},"extensions":{"pinned_extensions":["pfoejdcoooobifjhbnemjanhjlkkgbea","user-extension"]}}')
        [IO.File]::WriteAllText((Join-Path $extensions 'manifest.json'), '{"fixture":true}')
        Write-TestInstalledSettings $state $data $extensions $deletedExe
        [IO.File]::WriteAllText((Join-Path $state 'user-note.txt'), 'keep this user file')
        foreach ($name in @('Set-NeoFullUrlAddressBar.ps1', 'NeoPaths.ps1', 'NeoPersistence.ps1', 'Invoke-NeoToolbar.ps1', 'last-repair.log')) {
            [IO.File]::WriteAllText((Join-Path $state $name), 'owned runtime fixture')
        }
        & $script:MainScript -Undo -StateDir $state -SkipShortcuts -SkipUrlHandlers -SkipAutoStart
        Assert-True (-not (Test-Path -LiteralPath $deletedExe)) 'Undo recreated or executed the removed browser.'
        Assert-True (-not (Test-Path -LiteralPath $extensions)) 'Undo did not use the saved custom extension directory.'
        $json = [Text.Json.Nodes.JsonNode]::Parse([IO.File]::ReadAllText($preferences))
        Assert-True ($null -eq $json['omnibox']['prevent_url_elisions']) 'Undo did not use the saved custom profile directory.'
        Assert-Equal 'keep' ([string]$json['omnibox']['other']) 'Undo lost an unrelated custom profile value.'
        Assert-Equal '["user-extension"]' ($json['extensions']['pinned_extensions'].ToJsonString()) 'Undo lost the custom profile user pin.'
        Assert-Equal 'keep this user file' ([IO.File]::ReadAllText((Join-Path $state 'user-note.txt'))) 'Undo deleted an unrelated state file.'
        foreach ($name in @('Set-NeoFullUrlAddressBar.ps1', 'NeoPaths.ps1', 'NeoPersistence.ps1', 'Invoke-NeoToolbar.ps1', 'settings.json', 'last-repair.log')) {
            Assert-True (-not (Test-Path -LiteralPath (Join-Path $state $name))) "Undo left the owned runtime file $name."
        }
    }

    Run-Test 'Undo from the deployed runtime removes its colocated extension and only owned runtime files' {
        $fixture = New-FixtureDirectory 'DeployedRuntimeUndo'
        $state = Join-Path $fixture 'Runtime [Portable] (Local)'
        $data = Join-Path $fixture 'Custom Profile Data'
        $extensions = Join-Path $state 'zoom-controls'
        $deletedExe = Join-Path $fixture 'Removed Neo\neo.exe'
        [void][IO.Directory]::CreateDirectory((Join-Path $data 'Default'))
        [void][IO.Directory]::CreateDirectory($extensions)
        [IO.File]::WriteAllText((Join-Path $data 'Default\Preferences'), '{"omnibox":{"prevent_url_elisions":true},"unrelated":"keep"}')
        foreach ($name in @('Set-NeoFullUrlAddressBar.ps1', 'NeoPaths.ps1', 'NeoPersistence.ps1', 'Invoke-NeoToolbar.ps1')) {
            Copy-Item -LiteralPath (Join-Path (Split-Path $PSScriptRoot) $name) -Destination (Join-Path $state $name)
        }
        Copy-Item -LiteralPath (Join-Path (Split-Path $PSScriptRoot) 'zoom-controls\manifest.json') -Destination (Join-Path $extensions 'manifest.json')
        [IO.File]::WriteAllText((Join-Path $extensions 'background.js'), 'extension fixture')
        Write-TestInstalledSettings $state $data $extensions $deletedExe
        [IO.File]::WriteAllText((Join-Path $state 'last-repair.log'), 'owned log fixture')
        [IO.File]::WriteAllText((Join-Path $state 'user-note.txt'), 'preserve note')
        [IO.File]::WriteAllText((Join-Path $state 'unrelated-script.ps1'), 'preserve script')
        & (Join-Path $state 'Set-NeoFullUrlAddressBar.ps1') -Undo -StateDir $state -SkipShortcuts -SkipUrlHandlers -SkipAutoStart
        Assert-True (-not (Test-Path -LiteralPath $extensions)) 'Undo skipped the extension because source and deployment paths were equal.'
        foreach ($name in @('Set-NeoFullUrlAddressBar.ps1', 'NeoPaths.ps1', 'NeoPersistence.ps1', 'Invoke-NeoToolbar.ps1', 'settings.json', 'last-repair.log')) {
            Assert-True (-not (Test-Path -LiteralPath (Join-Path $state $name))) "Deployed Undo left the owned runtime file $name."
        }
        Assert-Equal 'preserve note' ([IO.File]::ReadAllText((Join-Path $state 'user-note.txt'))) 'Deployed Undo deleted the user note.'
        Assert-Equal 'preserve script' ([IO.File]::ReadAllText((Join-Path $state 'unrelated-script.ps1'))) 'Deployed Undo swept an unrelated script.'
        $json = [Text.Json.Nodes.JsonNode]::Parse([IO.File]::ReadAllText((Join-Path $data 'Default\Preferences')))
        Assert-True ($null -eq $json['omnibox']['prevent_url_elisions']) 'Deployed Undo did not clean the saved profile.'
        Assert-Equal 'keep' ([string]$json['unrelated']) 'Deployed Undo changed an unrelated profile preference.'
    }
}
finally {
    Remove-Variable -Scope Global -Name @('NeoToolbarTestCimProcesses', 'NeoToolbarTestFixtureRoot', 'NeoToolbarTestLinks', 'NeoToolbarTestAllowShortcutSave', 'NeoToolbarTestShortcutSaveCount') -ErrorAction SilentlyContinue
    # Cleanup is restricted to this run's unique temporary fixture directory.
    $resolved = [IO.Path]::GetFullPath($script:FixtureRoot)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    if ($resolved.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and
        [IO.Path]::GetFileName($resolved) -match '^NeoToolbarTests-[a-f0-9]{32}$') {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}

Write-Host "`nRegression tests: $script:Passed passed, $script:Failed failed."
if ($script:Failed) { exit 1 }
