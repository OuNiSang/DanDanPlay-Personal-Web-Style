[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+(\.\d+)?$')]
    [string]$Version,
    [string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$packageRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$payloadRoot = Join-Path $packageRoot 'payload'
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $packageRoot 'dist'
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$name = 'DanDanPlay-Personal-Web-Style-' + $Version
$zipPath = Join-Path $OutputDirectory ($name + '.zip')
$checksumPath = $zipPath + '.sha256'
if ((Test-Path -LiteralPath $zipPath) -or (Test-Path -LiteralPath $checksumPath)) {
    throw 'A release artifact already exists. Use a new output directory; never overwrite a published artifact.'
}

function Get-ContainedPath {
    param([string]$Root, [string]$Relative)
    if ([IO.Path]::IsPathRooted($Relative) -or $Relative -match '(^|[\\/])\.\.([\\/]|$)') {
        throw "Invalid relative package path: $Relative"
    }
    $prefix = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    $full = [IO.Path]::GetFullPath((Join-Path $prefix $Relative))
    if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { throw 'Package path escaped its root.' }
    return $full
}

$manifest = @(Get-Content -LiteralPath (Join-Path $packageRoot 'manifest.txt') |
    ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') })
if (-not $manifest.Count -or @($manifest | Sort-Object -Unique).Count -ne $manifest.Count) {
    throw 'The manifest must be non-empty and contain no duplicate entries.'
}
$actualPayload = @(Get-ChildItem -LiteralPath $payloadRoot -Recurse -File | ForEach-Object {
    $_.FullName.Substring($payloadRoot.Length + 1).Replace('\', '/')
})
if (Compare-Object -ReferenceObject @($manifest | Sort-Object) -DifferenceObject @($actualPayload | Sort-Object)) {
    throw 'The payload files do not exactly match manifest.txt.'
}
$members = @('manage-style.bat', 'manifest.txt', 'scripts/manage-style.ps1', 'LICENSE', 'INSTALL.md')
$members += @($manifest | ForEach-Object { 'payload/' + $_ })
foreach ($relative in $members) {
    $source = Get-ContainedPath $packageRoot $relative
    if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Missing package member: $relative" }
    if ($relative -match '(^|/)(AGENTS\.md|\.git|\.audit|screenshots|private-|\.codex_tmp)') {
        throw "Disallowed release member: $relative"
    }
}
$installText = Get-Content -LiteralPath (Join-Path $packageRoot 'INSTALL.md') -Raw
if (-not $installText.Contains('版本：' + $Version)) { throw 'INSTALL.md does not match the requested version.' }

$tempBase = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$stagingRoot = Join-Path $tempBase ('ddp-release-' + [guid]::NewGuid().ToString('N'))
$archiveRoot = Join-Path $stagingRoot $name
try {
    New-Item -ItemType Directory -Path $archiveRoot -Force | Out-Null
    foreach ($relative in $members) {
        $target = Get-ContainedPath $archiveRoot $relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        Copy-Item -LiteralPath (Get-ContainedPath $packageRoot $relative) -Destination $target
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::CreateFromDirectory($archiveRoot, $zipPath, [IO.Compression.CompressionLevel]::Optimal, $true)
    $archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        $expected = @($members | ForEach-Object { $name + '/' + $_ } | Sort-Object)
        $actual = @($archive.Entries | Where-Object { $_.Name } | ForEach-Object { $_.FullName.Replace('\','/') } | Sort-Object)
        if (Compare-Object -ReferenceObject $expected -DifferenceObject $actual) { throw 'ZIP member validation failed.' }
        foreach ($entry in $archive.Entries) {
            if (-not $entry.Name) { continue }
            $relative = $entry.FullName.Replace('\','/').Substring($name.Length + 1)
            $inputStream = $entry.Open()
            $hasher = [Security.Cryptography.SHA256]::Create()
            try { $zipHash = [BitConverter]::ToString($hasher.ComputeHash($inputStream)).Replace('-','') }
            finally { $inputStream.Dispose(); $hasher.Dispose() }
            $sourceHash = (Get-FileHash -LiteralPath (Get-ContainedPath $packageRoot $relative) -Algorithm SHA256).Hash
            if ($zipHash -ne $sourceHash) { throw "ZIP content differs: $relative" }
        }
    }
    finally { $archive.Dispose() }
    $sha256 = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText($checksumPath, $sha256 + '  ' + [IO.Path]::GetFileName($zipPath) + "`n", [Text.UTF8Encoding]::new($false))
    [pscustomobject]@{ Version=$Version; Path=$zipPath; Bytes=(Get-Item -LiteralPath $zipPath).Length;
        Sha256=$sha256; PayloadFiles=$manifest.Count; ArchiveFiles=$members.Count } | ConvertTo-Json
}
finally {
    $resolvedStage = [IO.Path]::GetFullPath($stagingRoot).TrimEnd('\') + '\'
    if (-not $resolvedStage.StartsWith($tempBase, [StringComparison]::OrdinalIgnoreCase) -or
        (Split-Path -Leaf $stagingRoot) -notlike 'ddp-release-*') { throw 'Unsafe staging cleanup target.' }
    if (Test-Path -LiteralPath $stagingRoot) { Remove-Item -LiteralPath $stagingRoot -Recurse -Force }
}
