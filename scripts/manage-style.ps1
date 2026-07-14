[CmdletBinding()]
param(
    [ValidateSet('menu', 'install', 'restore', 'status')]
    [string]$Action = 'menu',
    [string]$TargetPath,
    [string]$StatePath
)

$ErrorActionPreference = 'Stop'

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
        throw "Manifest entry must be relative: $RelativePath"
    }

    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $candidate = [IO.Path]::GetFullPath((Join-Path $rootFull $RelativePath))
    if (-not $candidate.StartsWith($rootFull, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Manifest entry escapes its root: $RelativePath"
    }

    return $candidate
}

function Get-ManifestEntries {
    param([string]$Path = $manifestPath)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Missing manifest: $Path"
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
            throw "Payload file is missing: $entry"
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
        throw "DanDanPlay Web1 directory was not found: $TargetPath"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $TargetPath 'index.html') -PathType Leaf)) {
        throw "The selected directory does not look like a DanDanPlay Web1 directory: $TargetPath"
    }
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
    Assert-TargetDirectory
    New-Item -ItemType Directory -Force -Path $stateRoot, $backupRoot | Out-Null

    if (Test-PayloadMatchesTarget) {
        Write-Host '[INFO] The style is already installed. Reapplying without creating a duplicate backup.'
    }
    else {
        $backupDirectory = New-CurrentBackup
        Write-Host "[OK] Current Web1 files were backed up to: $backupDirectory"
    }

    foreach ($entry in (Get-ManifestEntries)) {
        $payloadFile = Get-SafeChildPath -Root $payloadRoot -RelativePath $entry
        $targetFile = Get-SafeChildPath -Root $TargetPath -RelativePath $entry
        Ensure-ParentDirectory -Path $targetFile
        Copy-Item -LiteralPath $payloadFile -Destination $targetFile -Force
    }

    if (-not (Test-PayloadMatchesTarget)) {
        throw 'Installation verification failed.'
    }

    Write-Host '[OK] DanDanPlay Personal Web Style is installed.' -ForegroundColor Green
}

function Get-LatestBackup {
    if (-not (Test-Path -LiteralPath $latestBackupPath -PathType Leaf)) {
        throw 'No backup is available. Install the style once before using rollback.'
    }

    $backupDirectory = (Get-Content -LiteralPath $latestBackupPath -Raw).Trim()
    $backupRootFull = [IO.Path]::GetFullPath($backupRoot).TrimEnd('\') + '\'
    $backupFull = [IO.Path]::GetFullPath($backupDirectory).TrimEnd('\') + '\'
    if (-not $backupFull.StartsWith($backupRootFull, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The saved backup path is invalid.'
    }
    if (-not (Test-Path -LiteralPath $backupDirectory -PathType Container)) {
        throw "The latest backup no longer exists: $backupDirectory"
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
            throw "Backup is incomplete: $entry"
        }
    }

    Write-Host "[OK] Restored Web1 files from: $backupDirectory" -ForegroundColor Green
}

function Show-Status {
    Write-Host "Target: $TargetPath"
    if (-not (Test-Path -LiteralPath $TargetPath -PathType Container)) {
        Write-Host 'Status: DanDanPlay Web1 directory not found.' -ForegroundColor Yellow
        return
    }

    if (Test-PayloadMatchesTarget) {
        Write-Host 'Status: style installed.' -ForegroundColor Green
    }
    else {
        Write-Host 'Status: official, updated, or otherwise different files detected.' -ForegroundColor Yellow
    }

    if (Test-Path -LiteralPath $latestBackupPath -PathType Leaf) {
        Write-Host ('Latest backup: ' + (Get-Content -LiteralPath $latestBackupPath -Raw).Trim())
    }
    else {
        Write-Host 'Latest backup: none'
    }
}

function Invoke-Menu {
    while ($true) {
        Clear-Host
        Write-Host 'DanDanPlay Personal Web Style'
        Write-Host '================================'
        Write-Host '[1] Install or reapply the style'
        Write-Host '[2] Roll back to the latest backup'
        Write-Host '[3] Show installation status'
        Write-Host '[0] Exit'
        Write-Host ''
        $choice = Read-Host 'Select an action'

        try {
            switch ($choice) {
                '1' { Install-Style }
                '2' { Restore-LatestBackup }
                '3' { Show-Status }
                '0' { return }
                default { Write-Host '[WARN] Unknown option.' -ForegroundColor Yellow }
            }
        }
        catch {
            Write-Host ('[ERROR] ' + $_.Exception.Message) -ForegroundColor Red
        }

        Write-Host ''
        Read-Host 'Press Enter to return to the menu' | Out-Null
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
    Write-Host ('[ERROR] ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
