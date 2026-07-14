[CmdletBinding()]
param(
    [ValidateSet('menu', 'install', 'restore', 'status')]
    [string]$Action = 'menu',
    [ValidateSet('zh-CN', 'en-US')]
    [string]$Language = 'zh-CN',
    [string]$TargetPath,
    [string]$StatePath,
    [switch]$Force
)

$ErrorActionPreference = 'Stop'
$SupportedDanDanPlayVersion = '18.1.0'

try {
    [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
    [Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
}
catch {
    # Some redirected hosts do not expose console encodings.
}

$Messages = @{
    'zh-CN' = @{
        ManifestRelative = '清单条目必须使用相对路径：{0}'
        ManifestEscapes = '清单条目超出了允许目录：{0}'
        MissingManifest = '找不到文件清单：{0}'
        PayloadMissing = '覆盖包缺少文件：{0}'
        WebDirMissing = '找不到弹弹play Web1 目录：{0}'
        InvalidWebDir = '所选目录不像弹弹play Web1 目录：{0}'
        AlreadyInstalled = '[信息] 当前已经安装本界面，将直接重新应用，不重复创建备份。'
        BackupCreated = '[成功] 已将当前 Web1 文件备份到：{0}'
        InstallVerifyFailed = '安装后的文件校验失败。'
        Installed = '[成功] DanDanPlay Personal Web Style 已安装。'
        NoBackup = '没有可用备份。请至少安装一次界面后再使用回退。'
        InvalidBackupPath = '保存的备份路径无效。'
        BackupMissing = '最近一次备份已不存在：{0}'
        BackupIncomplete = '备份不完整，缺少：{0}'
        Restored = '[成功] 已从以下备份恢复 Web1 文件：{0}'
        Target = '目标目录：{0}'
        StatusNoDir = '状态：未找到弹弹play Web1 目录。'
        StatusInstalled = '状态：界面已安装。'
        StatusDifferent = '状态：检测到官方文件、版本更新文件或其他不同文件。'
        LatestBackup = '最近备份：{0}'
        LatestBackupNone = '最近备份：无'
        MenuTitle = 'DanDanPlay Personal Web Style 管理器'
        MenuInstall = '[1] 安装或重新应用界面'
        MenuRestore = '[2] 回退到最近一次备份'
        MenuStatus = '[3] 查看安装与版本状态'
        MenuLanguage = '[4] Switch to English'
        MenuExit = '[0] 退出'
        SelectAction = '请选择操作'
        UnknownOption = '[警告] 无效选项。'
        PressEnter = '按 Enter 返回菜单'
        ErrorPrefix = '[错误] {0}'
        ExpectedVersion = '界面适配版本：弹弹play {0}'
        DetectedVersion = '检测到本机版本：弹弹play {0}（来源：{1}）'
        VersionMatch = '[成功] 本机版本与界面适配版本一致。'
        VersionMismatch = '[警告] 本机弹弹play版本 {0} 与界面适配版本 {1} 不一致。继续覆盖可能导致页面或接口异常。'
        VersionUnknown = '[警告] 无法自动读取本机弹弹play版本，不能确认此界面是否兼容。'
        ContinueMismatch = '仍要继续安装吗？[y/N]'
        InstallCancelled = '[信息] 已取消安装，没有修改任何 Web1 文件。'
        ForceRequired = '版本不匹配或无法检测。命令行安装如需继续，请明确添加 -Force。'
        ForceAccepted = '[警告] 已使用 -Force 跳过版本兼容限制。'
        SourceExecutable = 'dandanplay.exe'
        SourceProcess = '运行中的弹弹play进程'
        SourceRegistry = 'Windows安装信息'
    }
    'en-US' = @{
        ManifestRelative = 'Manifest entry must be relative: {0}'
        ManifestEscapes = 'Manifest entry escapes its root: {0}'
        MissingManifest = 'Missing manifest: {0}'
        PayloadMissing = 'Payload file is missing: {0}'
        WebDirMissing = 'DanDanPlay Web1 directory was not found: {0}'
        InvalidWebDir = 'The selected directory does not look like a DanDanPlay Web1 directory: {0}'
        AlreadyInstalled = '[INFO] The style is already installed. Reapplying without creating a duplicate backup.'
        BackupCreated = '[OK] Current Web1 files were backed up to: {0}'
        InstallVerifyFailed = 'Installation verification failed.'
        Installed = '[OK] DanDanPlay Personal Web Style is installed.'
        NoBackup = 'No backup is available. Install the style once before using rollback.'
        InvalidBackupPath = 'The saved backup path is invalid.'
        BackupMissing = 'The latest backup no longer exists: {0}'
        BackupIncomplete = 'Backup is incomplete: {0}'
        Restored = '[OK] Restored Web1 files from: {0}'
        Target = 'Target: {0}'
        StatusNoDir = 'Status: DanDanPlay Web1 directory not found.'
        StatusInstalled = 'Status: style installed.'
        StatusDifferent = 'Status: official, updated, or otherwise different files detected.'
        LatestBackup = 'Latest backup: {0}'
        LatestBackupNone = 'Latest backup: none'
        MenuTitle = 'DanDanPlay Personal Web Style Manager'
        MenuInstall = '[1] Install or reapply the style'
        MenuRestore = '[2] Roll back to the latest backup'
        MenuStatus = '[3] Show installation and version status'
        MenuLanguage = '[4] 切换到中文'
        MenuExit = '[0] Exit'
        SelectAction = 'Select an action'
        UnknownOption = '[WARN] Unknown option.'
        PressEnter = 'Press Enter to return to the menu'
        ErrorPrefix = '[ERROR] {0}'
        ExpectedVersion = 'Style target version: DanDanPlay {0}'
        DetectedVersion = 'Detected local version: DanDanPlay {0} (source: {1})'
        VersionMatch = '[OK] The installed version matches the style target version.'
        VersionMismatch = '[WARN] Installed DanDanPlay {0} does not match the style target {1}. Continuing may break pages or APIs.'
        VersionUnknown = '[WARN] The installed DanDanPlay version could not be detected, so compatibility cannot be confirmed.'
        ContinueMismatch = 'Continue installation anyway? [y/N]'
        InstallCancelled = '[INFO] Installation cancelled. No Web1 files were changed.'
        ForceRequired = 'The version is incompatible or unknown. Add -Force to explicitly continue a command-line installation.'
        ForceAccepted = '[WARN] -Force was supplied; continuing without a compatible version result.'
        SourceExecutable = 'dandanplay.exe'
        SourceProcess = 'running DanDanPlay process'
        SourceRegistry = 'Windows installation data'
    }
}

function Get-Text {
    param(
        [Parameter(Mandatory = $true)][string]$Key,
        [object[]]$Values = @()
    )

    $text = $Messages[$script:Language][$Key]
    if ($null -eq $text) {
        $text = $Messages['en-US'][$Key]
    }
    if ($Values.Count -gt 0) {
        return [string]::Format($text, $Values)
    }
    return $text
}

$packageRoot = Split-Path -Parent $PSScriptRoot
$payloadRoot = Join-Path $packageRoot 'payload'
$manifestPath = Join-Path $packageRoot 'manifest.txt'
if ([string]::IsNullOrWhiteSpace($StatePath)) {
    $StatePath = Join-Path $env:LOCALAPPDATA 'DanDanPlay-Personal-Web-Style'
}
$stateRoot = $StatePath
$backupRoot = Join-Path $stateRoot 'backups'
$latestBackupPath = Join-Path $stateRoot 'latest-backup.txt'

if ([string]::IsNullOrWhiteSpace($TargetPath)) {
    $appFolderName = ([string][char]0x5F39) + ([string][char]0x5F39) + 'play'
    $TargetPath = Join-Path (Join-Path $env:APPDATA $appFolderName) 'web'
}

function Get-SafeChildPath {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$RelativePath
    )

    if ([IO.Path]::IsPathRooted($RelativePath)) {
        throw (Get-Text -Key 'ManifestRelative' -Values @($RelativePath))
    }

    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $candidate = [IO.Path]::GetFullPath((Join-Path $rootFull $RelativePath))
    if (-not $candidate.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
        throw (Get-Text -Key 'ManifestEscapes' -Values @($RelativePath))
    }

    return $candidate
}

function Get-ManifestEntries {
    param([string]$Path = $manifestPath)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw (Get-Text -Key 'MissingManifest' -Values @($Path))
    }

    return @(
        Get-Content -LiteralPath $Path |
            ForEach-Object { $_.Trim() } |
            Where-Object { $_ -and -not $_.StartsWith('#') }
    )
}

function Ensure-ParentDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)

    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        New-Item -ItemType Directory -Force -Path $parent | Out-Null
    }
}

function Test-PayloadMatchesTarget {
    $entries = Get-ManifestEntries
    foreach ($entry in $entries) {
        $payloadFile = Get-SafeChildPath -Root $payloadRoot -RelativePath $entry
        $targetFile = Get-SafeChildPath -Root $TargetPath -RelativePath $entry
        if (-not (Test-Path -LiteralPath $payloadFile -PathType Leaf)) {
            throw (Get-Text -Key 'PayloadMissing' -Values @($entry))
        }
        if (-not (Test-Path -LiteralPath $targetFile -PathType Leaf)) {
            return $false
        }
        if ((Get-FileHash -LiteralPath $payloadFile -Algorithm SHA256).Hash -ne
            (Get-FileHash -LiteralPath $targetFile -Algorithm SHA256).Hash) {
            return $false
        }
    }
    return $true
}

function Assert-TargetDirectory {
    if (-not (Test-Path -LiteralPath $TargetPath -PathType Container)) {
        throw (Get-Text -Key 'WebDirMissing' -Values @($TargetPath))
    }
    if (-not (Test-Path -LiteralPath (Join-Path $TargetPath 'index.html') -PathType Leaf)) {
        throw (Get-Text -Key 'InvalidWebDir' -Values @($TargetPath))
    }
}

function ConvertTo-ComparableVersion {
    param([string]$VersionText)

    if ([string]::IsNullOrWhiteSpace($VersionText)) {
        return $null
    }
    $match = [regex]::Match($VersionText, '\d+(?:\.\d+){1,3}')
    if (-not $match.Success) {
        return $null
    }
    try {
        $version = [version]$match.Value
        $build = $version.Build
        if ($build -lt 0) { $build = 0 }
        return ('{0}.{1}.{2}' -f $version.Major, $version.Minor, $build)
    }
    catch {
        return $null
    }
}

function New-VersionResult {
    param(
        [string]$RawVersion,
        [string]$SourceKey
    )

    $comparable = ConvertTo-ComparableVersion -VersionText $RawVersion
    if (-not $comparable) {
        return $null
    }
    return [pscustomobject]@{
        RawVersion = $RawVersion
        ComparableVersion = $comparable
        Source = Get-Text -Key $SourceKey
    }
}

function Get-InstalledDanDanPlayVersion {
    $appRoot = Split-Path -Parent $TargetPath
    $executablePath = Join-Path $appRoot 'dandanplay.exe'
    if (Test-Path -LiteralPath $executablePath -PathType Leaf) {
        try {
            $versionInfo = [Diagnostics.FileVersionInfo]::GetVersionInfo($executablePath)
            $rawVersion = $versionInfo.ProductVersion
            if ([string]::IsNullOrWhiteSpace($rawVersion)) {
                $rawVersion = $versionInfo.FileVersion
            }
            $result = New-VersionResult -RawVersion $rawVersion -SourceKey 'SourceExecutable'
            if ($result) { return $result }
        }
        catch {
            # Continue with fallback sources.
        }
    }

    $processes = @(Get-Process -Name 'dandanplay' -ErrorAction SilentlyContinue)
    foreach ($process in $processes) {
        try {
            $rawVersion = $process.MainModule.FileVersionInfo.ProductVersion
            if ([string]::IsNullOrWhiteSpace($rawVersion)) {
                $rawVersion = $process.MainModule.FileVersionInfo.FileVersion
            }
            $result = New-VersionResult -RawVersion $rawVersion -SourceKey 'SourceProcess'
            if ($result) { return $result }
        }
        catch {
            # Access to another process can be restricted; try the registry next.
        }
    }

    $registryPaths = @(
        'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
        'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
    )
    foreach ($registryPath in $registryPaths) {
        $items = @(Get-ItemProperty -Path $registryPath -ErrorAction SilentlyContinue)
        foreach ($item in $items) {
            if ($item.DisplayName -and $item.DisplayName -match 'DanDanPlay|弹弹play') {
                $result = New-VersionResult -RawVersion $item.DisplayVersion -SourceKey 'SourceRegistry'
                if ($result) { return $result }
            }
        }
    }

    return $null
}

function Get-VersionCheck {
    $installed = Get-InstalledDanDanPlayVersion
    if (-not $installed) {
        return [pscustomobject]@{ Status = 'unknown'; Installed = $null }
    }
    $status = 'mismatch'
    if ($installed.ComparableVersion -eq $SupportedDanDanPlayVersion) {
        $status = 'match'
    }
    return [pscustomobject]@{ Status = $status; Installed = $installed }
}

function Write-VersionStatus {
    param([Parameter(Mandatory = $true)]$Check)

    Write-Host (Get-Text -Key 'ExpectedVersion' -Values @($SupportedDanDanPlayVersion))
    if ($Check.Installed) {
        Write-Host (Get-Text -Key 'DetectedVersion' -Values @($Check.Installed.ComparableVersion, $Check.Installed.Source))
    }
    if ($Check.Status -eq 'match') {
        Write-Host (Get-Text -Key 'VersionMatch') -ForegroundColor Green
    }
    elseif ($Check.Status -eq 'mismatch') {
        Write-Host (Get-Text -Key 'VersionMismatch' -Values @($Check.Installed.ComparableVersion, $SupportedDanDanPlayVersion)) -ForegroundColor Yellow
    }
    else {
        Write-Host (Get-Text -Key 'VersionUnknown') -ForegroundColor Yellow
    }
}

function Confirm-VersionCompatibility {
    param([switch]$Interactive)

    $check = Get-VersionCheck
    Write-VersionStatus -Check $check
    if ($check.Status -eq 'match') {
        return $true
    }
    if ($Force) {
        Write-Host (Get-Text -Key 'ForceAccepted') -ForegroundColor Yellow
        return $true
    }
    if ($Interactive) {
        $answer = Read-Host (Get-Text -Key 'ContinueMismatch')
        if ($answer -match '^(?i:y|yes|是|继续)$') {
            return $true
        }
        Write-Host (Get-Text -Key 'InstallCancelled')
        return $false
    }
    throw (Get-Text -Key 'ForceRequired')
}

function New-CurrentBackup {
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $backupDirectory = Join-Path $backupRoot $timestamp
    $backupFiles = Join-Path $backupDirectory 'files'
    New-Item -ItemType Directory -Force -Path $backupFiles | Out-Null

    $missing = [Collections.Generic.List[string]]::new()
    $entries = Get-ManifestEntries
    foreach ($entry in $entries) {
        $sourceFile = Get-SafeChildPath -Root $TargetPath -RelativePath $entry
        $backupFile = Get-SafeChildPath -Root $backupFiles -RelativePath $entry
        if (Test-Path -LiteralPath $sourceFile -PathType Leaf) {
            Ensure-ParentDirectory -Path $backupFile
            Copy-Item -LiteralPath $sourceFile -Destination $backupFile -Force
        }
        else {
            $missing.Add($entry)
        }
    }

    Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $backupDirectory 'manifest.txt') -Force
    Set-Content -LiteralPath (Join-Path $backupDirectory 'missing.txt') -Value $missing -Encoding UTF8
    Set-Content -LiteralPath $latestBackupPath -Value $backupDirectory -Encoding UTF8
    return $backupDirectory
}

function Install-Style {
    param([switch]$Interactive)

    Assert-TargetDirectory
    if (-not (Confirm-VersionCompatibility -Interactive:$Interactive)) {
        return
    }
    New-Item -ItemType Directory -Force -Path $stateRoot, $backupRoot | Out-Null

    if (Test-PayloadMatchesTarget) {
        Write-Host (Get-Text -Key 'AlreadyInstalled')
    }
    else {
        $backupDirectory = New-CurrentBackup
        Write-Host (Get-Text -Key 'BackupCreated' -Values @($backupDirectory))
    }

    foreach ($entry in (Get-ManifestEntries)) {
        $payloadFile = Get-SafeChildPath -Root $payloadRoot -RelativePath $entry
        $targetFile = Get-SafeChildPath -Root $TargetPath -RelativePath $entry
        Ensure-ParentDirectory -Path $targetFile
        Copy-Item -LiteralPath $payloadFile -Destination $targetFile -Force
    }

    if (-not (Test-PayloadMatchesTarget)) {
        throw (Get-Text -Key 'InstallVerifyFailed')
    }

    Write-Host (Get-Text -Key 'Installed') -ForegroundColor Green
}

function Get-LatestBackup {
    if (-not (Test-Path -LiteralPath $latestBackupPath -PathType Leaf)) {
        throw (Get-Text -Key 'NoBackup')
    }

    $backupDirectory = (Get-Content -LiteralPath $latestBackupPath -Raw).Trim()
    $backupRootFull = [IO.Path]::GetFullPath($backupRoot).TrimEnd('\') + '\'
    $backupFull = [IO.Path]::GetFullPath($backupDirectory).TrimEnd('\') + '\'
    if (-not $backupFull.StartsWith($backupRootFull, [StringComparison]::OrdinalIgnoreCase)) {
        throw (Get-Text -Key 'InvalidBackupPath')
    }
    if (-not (Test-Path -LiteralPath $backupDirectory -PathType Container)) {
        throw (Get-Text -Key 'BackupMissing' -Values @($backupDirectory))
    }
    return $backupDirectory
}

function Restore-LatestBackup {
    Assert-TargetDirectory
    $backupDirectory = Get-LatestBackup
    $backupFiles = Join-Path $backupDirectory 'files'
    $backupManifest = Join-Path $backupDirectory 'manifest.txt'
    $missingPath = Join-Path $backupDirectory 'missing.txt'
    $missing = @()
    if (Test-Path -LiteralPath $missingPath -PathType Leaf) {
        $missing = @(Get-Content -LiteralPath $missingPath | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    }

    foreach ($entry in (Get-ManifestEntries -Path $backupManifest)) {
        $backupFile = Get-SafeChildPath -Root $backupFiles -RelativePath $entry
        $targetFile = Get-SafeChildPath -Root $TargetPath -RelativePath $entry
        if (Test-Path -LiteralPath $backupFile -PathType Leaf) {
            Ensure-ParentDirectory -Path $targetFile
            Copy-Item -LiteralPath $backupFile -Destination $targetFile -Force
        }
        elseif ($missing -contains $entry) {
            if (Test-Path -LiteralPath $targetFile -PathType Leaf) {
                Remove-Item -LiteralPath $targetFile -Force
            }
        }
        else {
            throw (Get-Text -Key 'BackupIncomplete' -Values @($entry))
        }
    }

    Write-Host (Get-Text -Key 'Restored' -Values @($backupDirectory)) -ForegroundColor Green
}

function Show-Status {
    Write-Host (Get-Text -Key 'Target' -Values @($TargetPath))
    if (-not (Test-Path -LiteralPath $TargetPath -PathType Container)) {
        Write-Host (Get-Text -Key 'StatusNoDir') -ForegroundColor Yellow
        return
    }

    Write-VersionStatus -Check (Get-VersionCheck)
    if (Test-PayloadMatchesTarget) {
        Write-Host (Get-Text -Key 'StatusInstalled') -ForegroundColor Green
    }
    else {
        Write-Host (Get-Text -Key 'StatusDifferent') -ForegroundColor Yellow
    }

    if (Test-Path -LiteralPath $latestBackupPath -PathType Leaf) {
        Write-Host (Get-Text -Key 'LatestBackup' -Values @((Get-Content -LiteralPath $latestBackupPath -Raw).Trim()))
    }
    else {
        Write-Host (Get-Text -Key 'LatestBackupNone')
    }
}

function Invoke-Menu {
    while ($true) {
        Clear-Host
        Write-Host (Get-Text -Key 'MenuTitle')
        Write-Host '========================================'
        Write-Host (Get-Text -Key 'MenuInstall')
        Write-Host (Get-Text -Key 'MenuRestore')
        Write-Host (Get-Text -Key 'MenuStatus')
        Write-Host (Get-Text -Key 'MenuLanguage')
        Write-Host (Get-Text -Key 'MenuExit')
        Write-Host ''
        $choice = Read-Host (Get-Text -Key 'SelectAction')
        $languageChanged = $false

        try {
            switch ($choice) {
                '1' { Install-Style -Interactive }
                '2' { Restore-LatestBackup }
                '3' { Show-Status }
                '4' {
                    if ($script:Language -eq 'zh-CN') { $script:Language = 'en-US' }
                    else { $script:Language = 'zh-CN' }
                    $languageChanged = $true
                }
                '0' { return }
                default { Write-Host (Get-Text -Key 'UnknownOption') -ForegroundColor Yellow }
            }
        }
        catch {
            Write-Host (Get-Text -Key 'ErrorPrefix' -Values @($_.Exception.Message)) -ForegroundColor Red
        }

        if ($languageChanged) { continue }
        Write-Host ''
        Read-Host (Get-Text -Key 'PressEnter') | Out-Null
    }
}

try {
    switch ($Action) {
        'install' { Install-Style }
        'restore' { Restore-LatestBackup }
        'status' { Show-Status }
        default { Invoke-Menu }
    }
}
catch {
    Write-Host (Get-Text -Key 'ErrorPrefix' -Values @($_.Exception.Message)) -ForegroundColor Red
    exit 1
}
