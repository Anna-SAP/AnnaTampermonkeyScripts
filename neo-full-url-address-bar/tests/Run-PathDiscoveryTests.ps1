#Requires -Version 7.2
<#
.SYNOPSIS
    Self-contained Neo path discovery regression tests; no Pester required.
.DESCRIPTION
    Creates empty neo.exe fixtures in one temporary directory and never executes
    them. Registry, CIM/process and shortcut discovery are replaced with in-memory
    fixtures. Common-directory discovery runs with isolated environment paths.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\NeoPaths.ps1')

$script:Passed = 0
$script:OriginalCommonDiscovery = (Get-Command Get-NeoCommonExecutableCandidates).ScriptBlock
$script:RunningCandidates = @()
$script:RegisteredCandidates = @()
$script:ShortcutCandidates = @()
$script:CommonCandidates = @()
$script:UseCommonDirectories = $false

# These replacements keep every Resolve-NeoExecutable test away from actual
# registry entries, other users' processes, and desktop/start-menu shortcuts.
function Get-NeoRunningExecutableCandidates { $script:RunningCandidates }
function Get-NeoRegisteredExecutableCandidates {
    param([string[]]$ProgIds)
    $script:RegisteredCandidates
}
function Get-NeoShortcutExecutableCandidates {
    param([string[]]$ShortcutRoots)
    $script:ShortcutCandidates
}
function Get-NeoCommonExecutableCandidates {
    if ($script:UseCommonDirectories) { & $script:OriginalCommonDiscovery }
    else { $script:CommonCandidates }
}

function Assert-Equal($Actual, $Expected) {
    if ($Actual -cne $Expected) { throw "Expected [$Expected], received [$Actual]." }
}

function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw $Message }
}

function Assert-Throws([scriptblock]$Action, [string]$MessagePattern) {
    $thrown = $false
    try { & $Action }
    catch {
        $thrown = $true
        if ($_.Exception.Message -notmatch $MessagePattern) { throw }
    }
    if (-not $thrown) { throw "Expected an error matching [$MessagePattern]." }
}

function Invoke-TestCase([string]$Name, [scriptblock]$Action) {
    try {
        & $Action
        $script:Passed++
        Write-Host "[PASS] $Name"
    } catch { throw "[FAIL] $Name`: $($_.Exception.Message)" }
}

function New-Candidate([string]$Path, [int]$Priority, [string]$Source = 'Fixture') {
    [pscustomobject]@{ Path = $Path; Priority = $Priority; Source = $Source }
}

$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/')
$testName = 'NeoPathDiscoveryTests-' + [guid]::NewGuid().ToString('N')
$script:TestRoot = [IO.Path]::GetFullPath((Join-Path $tempBase $testName))
$testRootPrefix = $script:TestRoot.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar

function New-FakeNeo([string]$RelativePath) {
    $path = [IO.Path]::GetFullPath((Join-Path $script:TestRoot $RelativePath))
    if (-not $path.StartsWith($testRootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Fixture path escapes the temporary test directory: $path"
    }
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $path))
    [IO.File]::WriteAllBytes($path, [byte[]]::new(0))
    $path
}

function Reset-DiscoveryFixtures {
    $script:RunningCandidates = @()
    $script:RegisteredCandidates = @()
    $script:ShortcutCandidates = @()
    $script:CommonCandidates = @()
    $script:UseCommonDirectories = $false
}

function Set-FakeComputerEnvironment([string]$Computer) {
    $env:LOCALAPPDATA = Join-Path $script:TestRoot "$Computer\用户 数据\Local"
    $env:ProgramFiles = Join-Path $script:TestRoot "$Computer\Program Files"
    ${env:ProgramFiles(x86)} = Join-Path $script:TestRoot "$Computer\Program Files (x86)"
    $env:ProgramW6432 = $env:ProgramFiles
    # Get-Command in common-directory discovery sees only the isolated PATH.
    $env:PATH = Join-Path $script:TestRoot "$Computer\EmptyPath"
}

$environmentNames = @('LOCALAPPDATA', 'ProgramFiles', 'ProgramFiles(x86)', 'ProgramW6432', 'PATH', 'NEO_PATH_DISCOVERY_TEST')
$originalEnvironment = @{}
foreach ($name in $environmentNames) {
    $originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

try {
    [void][IO.Directory]::CreateDirectory($script:TestRoot)
    $official = New-FakeNeo 'fixtures\正式 Neo\neo.exe'
    $shadow = New-FakeNeo 'fixtures\旧 Neo\neo.exe'
    $portable = New-FakeNeo 'fixtures\Portable Neo\neo.exe'
    $shortcutTarget = New-FakeNeo 'fixtures\Shortcut Neo\neo.exe'
    $running = New-FakeNeo 'fixtures\Running Neo\neo.exe'
    $missing = Join-Path $script:TestRoot 'missing\neo.exe'

    Invoke-TestCase 'Quoted Chinese path and arguments' {
        $parts = Get-NeoCommandParts ('"' + $official + '" --single-argument "%1"')
        Assert-Equal $parts.Path $official
        Assert-Equal $parts.Arguments '--single-argument "%1"'
    }
    Invoke-TestCase 'Unquoted executable path containing spaces' {
        $parts = Get-NeoCommandParts ($portable + ' --new-window "https://example.org/a b"')
        Assert-Equal $parts.Path $portable
        Assert-Equal $parts.Arguments '--new-window "https://example.org/a b"'
    }
    Invoke-TestCase 'Single-quoted executable path' {
        $parts = Get-NeoCommandParts ("'" + $portable + "' --new-window")
        Assert-Equal $parts.Path $portable
        Assert-Equal $parts.Arguments '--new-window'
    }
    Invoke-TestCase 'Executable without arguments' {
        $parts = Get-NeoCommandParts $official
        Assert-Equal $parts.Path $official
        Assert-Equal $parts.Arguments ''
    }
    Invoke-TestCase 'Environment path expands while arguments remain literal' {
        $env:NEO_PATH_DISCOVERY_TEST = $official
        $parts = Get-NeoCommandParts '%NEO_PATH_DISCOVERY_TEST% --data=%LOCALAPPDATA% "%1"'
        Assert-Equal $parts.Path $official
        Assert-Equal $parts.Arguments '--data=%LOCALAPPDATA% "%1"'
    }
    Invoke-TestCase 'Unrelated executables and wrapped commands are rejected' {
        foreach ($command in @('', '"C:\Browser\chrome.exe" --arg', 'cmd.exe /c "C:\Neo\neo.exe"', 'C:\Neo\neo.exe.invalid --x')) {
            Assert-True ($null -eq (Get-NeoCommandParts $command)) "Accepted unrelated command: $command"
        }
    }
    Invoke-TestCase 'ConvertFrom helper returns just the executable' {
        Assert-Equal (ConvertFrom-NeoExecutableCommand ('"' + $official + '" --new-window')) $official
    }
    Invoke-TestCase 'Candidate order follows priority' {
        $candidates = @((New-Candidate $shadow 80), (New-Candidate $official 20))
        Assert-Equal (Select-NeoExecutableCandidate $candidates) $official
    }
    Invoke-TestCase 'Missing higher-priority candidates are skipped' {
        $candidates = @((New-Candidate $missing 10), (New-Candidate $official 20))
        Assert-Equal (Select-NeoExecutableCandidate $candidates) $official
    }
    Invoke-TestCase 'Candidate deduplication is case insensitive' {
        $script:CheckedCandidates = [Collections.Generic.List[string]]::new()
        $candidates = @((New-Candidate $official 20), (New-Candidate $official.ToUpperInvariant() 20), (New-Candidate $portable 50))
        $selected = Select-NeoExecutableCandidate -Candidates $candidates -PathExists {
            param($Path)
            $script:CheckedCandidates.Add($Path)
            $Path -eq $portable
        }
        Assert-Equal $selected $portable
        Assert-Equal $script:CheckedCandidates.Count 2
    }
    Invoke-TestCase 'Equal-priority candidates retain discovery order' {
        Assert-Equal (Select-NeoExecutableCandidate @((New-Candidate $portable 20), (New-Candidate $official 20))) $portable
    }
    Invoke-TestCase 'String candidates are supported' {
        Assert-Equal (Select-NeoExecutableCandidate @($missing, $official)) $official
    }
    Invoke-TestCase 'Non-Neo files and directories are rejected' {
        $other = New-FakeNeo 'fixtures\not-neo.txt'
        $directory = Join-Path $script:TestRoot 'fixtures\directory\neo.exe'
        [void][IO.Directory]::CreateDirectory($directory)
        Assert-True ($null -eq (Select-NeoExecutableCandidate @($other, $directory))) 'Accepted a different filename or a directory.'
    }
    Invoke-TestCase 'Empty candidates return no path' {
        Assert-True ($null -eq (Select-NeoExecutableCandidate @())) 'An empty candidate list returned a path.'
    }
    Invoke-TestCase 'Explicit executable overrides discovered registrations' {
        Reset-DiscoveryFixtures
        $script:RegisteredCandidates = @((New-Candidate $official 20))
        Assert-Equal (Resolve-NeoExecutable -ExplicitPath $portable) $portable
    }
    Invoke-TestCase 'Invalid explicit path fails without silently falling back' {
        Assert-Throws { Resolve-NeoExecutable -ExplicitPath $missing } '指定的 Neo'
    }
    Invoke-TestCase 'Current-user process candidate takes precedence' {
        Reset-DiscoveryFixtures
        $script:RunningCandidates = @((New-Candidate $running 10))
        $script:RegisteredCandidates = @((New-Candidate $official 20))
        Assert-Equal (Resolve-NeoExecutable -HintPath $portable) $running
    }
    Invoke-TestCase 'Official registration outranks an existing HKCU shadow and hint' {
        Reset-DiscoveryFixtures
        $script:RegisteredCandidates = @((New-Candidate $shadow 80 'HKCU/ProgIdShadow'), (New-Candidate $official 20 'HKLM/AppPaths'))
        Assert-Equal (Resolve-NeoExecutable -HintPath $portable) $official
    }
    Invoke-TestCase 'Shortcut candidate outranks an existing HKCU shadow' {
        Reset-DiscoveryFixtures
        $script:RegisteredCandidates = @((New-Candidate $shadow 80))
        $script:ShortcutCandidates = @((New-Candidate $shortcutTarget 50))
        Assert-Equal (Resolve-NeoExecutable) $shortcutTarget
    }
    Invoke-TestCase 'Common install candidate outranks an existing HKCU shadow' {
        Reset-DiscoveryFixtures
        $script:RegisteredCandidates = @((New-Candidate $shadow 80))
        $script:CommonCandidates = @((New-Candidate $official 60))
        Assert-Equal (Resolve-NeoExecutable) $official
    }
    Invoke-TestCase 'HKCU shadow remains usable as a last registration fallback' {
        Reset-DiscoveryFixtures
        $script:RegisteredCandidates = @((New-Candidate $missing 20), (New-Candidate $shadow 80))
        Assert-Equal (Resolve-NeoExecutable) $shadow
    }
    Invoke-TestCase 'Portable hint is used when automatic sources are empty' {
        Reset-DiscoveryFixtures
        Assert-Equal (Resolve-NeoExecutable -HintPath $portable) $portable
    }
    Invoke-TestCase 'No available executable produces actionable error' {
        Reset-DiscoveryFixtures
        Assert-Throws { Resolve-NeoExecutable -HintPath $missing } '未找到 Neo.*-NeoExe'
    }

    Invoke-TestCase 'Computer A discovers its own Program Files installation' {
        Reset-DiscoveryFixtures
        Set-FakeComputerEnvironment 'ComputerA'
        $script:ComputerAExe = New-FakeNeo 'ComputerA\Program Files\Neo\Application\neo.exe'
        $script:ComputerALocal = $env:LOCALAPPDATA
        $script:UseCommonDirectories = $true
        Assert-Equal (Resolve-NeoExecutable) $script:ComputerAExe
    }
    Invoke-TestCase 'Computer B uses its own LOCALAPPDATA despite saved Computer A hint' {
        Set-FakeComputerEnvironment 'ComputerB'
        $script:ComputerBOldExe = New-FakeNeo 'ComputerB\用户 数据\Local\Programs\Neo\Application\neo.exe'
        Assert-True ($env:LOCALAPPDATA -ne $script:ComputerALocal) 'Computer environments must differ.'
        Assert-Equal (Resolve-NeoExecutable -HintPath $script:ComputerAExe) $script:ComputerBOldExe
    }
    Invoke-TestCase 'Next launch discovers updated registration after old executable disappears' {
        # This is the second Resolve round on B, following the initial B launch.
        Remove-Item -LiteralPath $script:ComputerBOldExe -Force
        $script:ComputerBNewExe = New-FakeNeo 'ComputerB\新安装位置\Neo\Application\neo.exe'
        $script:RegisteredCandidates = @(
            (New-Candidate $script:ComputerBOldExe 80 'HKCU/OldScriptShadow'),
            (New-Candidate $script:ComputerBNewExe 20 'HKLM/NewAppPaths')
        )
        Assert-True (-not (Test-Path -LiteralPath $script:ComputerBOldExe)) 'Old executable must have disappeared.'
        Assert-Equal (Resolve-NeoExecutable -HintPath $script:ComputerBOldExe) $script:ComputerBNewExe
    }
    Invoke-TestCase 'Repeated discovery keeps the new registration' {
        Assert-Equal (Resolve-NeoExecutable -HintPath $script:ComputerAExe) $script:ComputerBNewExe
    }

    Invoke-TestCase 'Per-user suffixed ProgIds match their base names only' {
        $names = @('neohtm.QS4PLG7L3G6JTSDVSNQ5M67CPU', 'NeoHTMLFile', 'NeoPDF.QS4PLG7L3G6JTSDVSNQ5M67CPU',
            'CometHTM.QS4PLG7L3G6JTSDVSNQ5M67CPU', 'NeoHTM', 'NEOHTM', 'neo', 'NeoUpdate.Update3WebUser')
        $actual = @(Select-NeoProgIdNames $names @('NeoHTM', 'NeoPDF'))
        Assert-Equal ($actual -join '|') 'neohtm.QS4PLG7L3G6JTSDVSNQ5M67CPU|NeoHTM|NeoPDF.QS4PLG7L3G6JTSDVSNQ5M67CPU'
        Assert-Equal @(Select-NeoProgIdNames @() @('NeoHTM')).Count 0
    }
} finally {
    foreach ($name in $environmentNames) {
        [Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name], 'Process')
    }
    # Validate the resolved absolute target immediately before recursive cleanup.
    # Only this exact GUID-named child of the original temp directory is allowed.
    $cleanupPath = [IO.Path]::GetFullPath($script:TestRoot).TrimEnd('\', '/')
    $expectedPath = [IO.Path]::GetFullPath((Join-Path $tempBase $testName)).TrimEnd('\', '/')
    $tempPrefix = $tempBase + [IO.Path]::DirectorySeparatorChar
    if ($cleanupPath -ne $expectedPath -or
        -not $cleanupPath.StartsWith($tempPrefix, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($cleanupPath) -ne $testName) {
        throw "Refusing cleanup outside the temporary test directory: $cleanupPath"
    }
    if (Test-Path -LiteralPath $cleanupPath -PathType Container) {
        Remove-Item -LiteralPath $cleanupPath -Recurse -Force
    }
}

Write-Host "PASS: $script:Passed Neo path discovery tests. Temporary fixtures removed."
