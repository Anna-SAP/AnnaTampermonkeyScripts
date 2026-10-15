# Browser entry-point maintenance. Dot-sourced by Set-NeoFullUrlAddressBar.ps1.
function Edit-NeoCommandLine([string]$CommandLine, [switch]$Managed) {
    $parts = Get-NeoCommandParts $CommandLine
    if (-not $parts) { return $CommandLine }
    $path = Get-NormalizedPath $parts.Path
    $currentExe = Get-NormalizedPath $NeoExe
    if (-not $Managed -and $path -ine $currentExe -and (Test-Path -LiteralPath $path -PathType Leaf)) { return $CommandLine }
    $arguments = Edit-NeoSwitches $parts.Arguments
    # Undo removes our flags without changing the user's executable registration.
    $target = if ($Undo) { $parts.Path } else { $currentExe }
    ('"' + $target + '" ' + $arguments).TrimEnd()
}

function Update-NeoAutoStart {
    Write-Step '已有 Neo 登录启动命令（Run，不新增 Neo 自启动）'
    foreach ($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryHive]::LocalMachine)) {
        foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
            $base = $null
            $key = $null
            try {
                $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
                $path = 'Software\Microsoft\Windows\CurrentVersion\Run'
                $key = $base.OpenSubKey($path)
                if (-not $key) { continue }
                foreach ($name in $key.GetValueNames()) {
                    $kind = $key.GetValueKind($name)
                    if ($kind -notin @([Microsoft.Win32.RegistryValueKind]::String, [Microsoft.Win32.RegistryValueKind]::ExpandString)) { continue }
                    $current = [string]$key.GetValue($name, $null, 'DoNotExpandEnvironmentNames')
                    $new = Edit-NeoCommandLine $current
                    if ($new -ceq $current) { continue }
                    $label = "$hive/$view\$path [$name]"
                    # A per-user extension path must not be written into an all-users startup command.
                    if ($hive -eq [Microsoft.Win32.RegistryHive]::LocalMachine) {
                        Write-Warning "检测到所有用户的 Neo 自启动，保留原命令：$label。请使用「Neo（工具栏增强）」冷启动。"
                        continue
                    }
                    if ($new.Length -gt 260) {
                        Write-Warning "保留长度将超过 Windows Run 260 字符限制的命令：$label。请使用「Neo（工具栏增强）」入口。"
                        continue
                    }
                    if ($PSCmdlet.ShouldProcess($label, "改为 $new")) {
                        $writable = $null
                        try {
                            $writable = $base.OpenSubKey($path, $true)
                            $writable.SetValue($name, $new, $kind)
                            Write-Done $label
                        }
                        catch { Write-Warning "无法修复 $label（可能需要管理员权限）：$($_.Exception.Message)" }
                        finally { if ($writable) { $writable.Dispose() } }
                    }
                }
            }
            catch { Write-Warning "无法检查 $hive/$view 登录启动命令：$($_.Exception.Message)" }
            finally {
                if ($key) { $key.Dispose() }
                if ($base) { $base.Dispose() }
            }
        }
    }
}

function Update-NeoManagedShortcut([string]$Path, [string]$Runner, [string]$PwshExe, [switch]$RepairOnly, [switch]$Remove) {
    $shell = New-Object -ComObject WScript.Shell
    $link = $shell.CreateShortcut($Path)
    $runnerArgument = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -File "' + $Runner + '"'
    if ($RepairOnly) { $runnerArgument += ' -RepairOnly' }
    $exists = Test-Path -LiteralPath $Path -PathType Leaf
    # A reserved name alone is not ownership: never overwrite/delete an unrelated shortcut.
    if ($exists -and ([string]$link.Arguments).IndexOf(('"' + $Runner + '"'), [StringComparison]::OrdinalIgnoreCase) -lt 0) {
        Write-Warning "保留同名的其他快捷方式：$Path"
        return
    }
    if ($Remove) {
        if ($exists -and $PSCmdlet.ShouldProcess($Path, '删除本工具的快捷方式')) {
            Remove-Item -LiteralPath $Path
            Write-Done "已删除 $Path"
        }
        return
    }
    if ($exists -and $link.TargetPath -ieq $PwshExe -and $link.Arguments -ceq $runnerArgument -and
        $link.IconLocation -ieq "$NeoExe,0") { Write-Same $Path; return }
    if ($PSCmdlet.ShouldProcess($Path, $(if ($RepairOnly) { '创建/修复登录维护快捷方式' } else { '创建/修复 Neo（工具栏增强）入口' }))) {
        New-Item -ItemType Directory -Path (Split-Path $Path) -Force | Out-Null
        $link.TargetPath = $PwshExe
        $link.Arguments = $runnerArgument
        $link.WorkingDirectory = Split-Path $Runner
        $link.IconLocation = "$NeoExe,0"
        $link.Description = if ($RepairOnly) { '修复 Neo 工具栏启动入口，不启动或关闭浏览器' } else { '自动定位 Neo 并携带工具栏配置启动' }
        $link.WindowStyle = 7
        $link.Save()
        Write-Done $Path
    }
}

function Update-NeoToolbarRuntime {
    Write-Step '固定启动入口与登录自动修复'
    $state = Get-NormalizedPath $StateDir
    $runner = Join-Path $state 'Invoke-NeoToolbar.ps1'
    $pwshExe = Join-Path $PSHOME 'pwsh.exe'
    $programs = [Environment]::GetFolderPath('Programs')
    $startup = [Environment]::GetFolderPath('Startup')
    $launcherLink = Join-Path $programs 'Neo（工具栏增强）.lnk'
    $repairLink = Join-Path $startup 'Neo 工具栏自动修复.lnk'
    $runtimeFiles = @('Set-NeoFullUrlAddressBar.ps1', 'NeoPaths.ps1', 'NeoPersistence.ps1', 'Invoke-NeoToolbar.ps1')
    $settingsPath = Join-Path $state 'settings.json'
    if ($Undo) {
        Update-NeoManagedShortcut -Path $launcherLink -Runner $runner -PwshExe $pwshExe -Remove
        Update-NeoManagedShortcut -Path $repairLink -Runner $runner -PwshExe $pwshExe -Remove
        # Delete only our named runtime files; do not recursively delete a configurable directory.
        $owned = $false
        if (Test-Path -LiteralPath $settingsPath -PathType Leaf) {
            try { $owned = (Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json).Owner -eq $Marker } catch { }
        }
        if ($owned) {
            foreach ($name in $runtimeFiles + @('settings.json', 'last-repair.log')) {
                $file = Join-Path $state $name
                if ((Test-Path -LiteralPath $file -PathType Leaf) -and $PSCmdlet.ShouldProcess($file, '删除本工具的运行文件')) {
                    Remove-Item -LiteralPath $file
                    Write-Done "已删除 $file"
                }
            }
        }
        return
    }
    foreach ($name in $runtimeFiles) {
        $source = Join-Path $PSScriptRoot $name
        $target = Join-Path $state $name
        if ((Get-NormalizedPath $source) -ieq (Get-NormalizedPath $target)) { continue }
        if ((Test-Path -LiteralPath $target -PathType Leaf) -and (Get-FileHash -LiteralPath $source).Hash -eq (Get-FileHash -LiteralPath $target).Hash) { continue }
        if ($PSCmdlet.ShouldProcess($target, '部署固定运行文件')) {
            New-Item -ItemType Directory -Path $state -Force | Out-Null
            Copy-Item -LiteralPath $source -Destination $target -Force
            Write-Done $target
        }
    }
    $settings = [ordered]@{
        Owner = $Marker
        SchemaVersion = 1
        NeoExeHint = $NeoExe
        PreferredNeoExe = $PreferredNeoExe
        UserDataDir = (Get-NormalizedPath $UserDataDir)
        ExtensionDir = $ExtensionDir
        StateDir = $state
        ShortcutRoots = @($ShortcutRoots)
        ProgIds = @($ProgIds)
        KeepVerticalTabsButton = [bool]$KeepVerticalTabsButton
        NoZoomControls = [bool]$NoZoomControls
        SkipPreferences = [bool]$SkipPreferences
        SkipShortcuts = [bool]$SkipShortcuts
        SkipUrlHandlers = [bool]$SkipUrlHandlers
        SkipAutoStart = [bool]$SkipAutoStart
        NoAutoRepair = [bool]$NoAutoRepair
    }
    $json = $settings | ConvertTo-Json -Depth 5
    if (-not (Test-Path -LiteralPath $settingsPath -PathType Leaf) -or [IO.File]::ReadAllText($settingsPath) -cne $json) {
        if ($PSCmdlet.ShouldProcess($settingsPath, '保存本机设置（下次仍重新识别安装位置）')) {
            New-Item -ItemType Directory -Path $state -Force | Out-Null
            [IO.File]::WriteAllText($settingsPath, $json, [Text.UTF8Encoding]::new($false))
            Write-Done $settingsPath
        }
    }
    Update-NeoManagedShortcut -Path $launcherLink -Runner $runner -PwshExe $pwshExe
    Update-NeoManagedShortcut -Path $repairLink -Runner $runner -PwshExe $pwshExe -RepairOnly -Remove:($NoAutoRepair.IsPresent)
}
