param(
    [string]$Configuration = "Release",
    [string]$Runtime = "win-x64",
    [string]$Output = "dist\FluentSSH-native-win-x64"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$project = Join-Path $root "native\FluentSSH\FluentSSH.csproj"
$outputPath = Join-Path $root $Output

Write-Host "Publishing FluentSSH Native to $outputPath"
Get-Process FluentSSH -ErrorAction SilentlyContinue | Stop-Process -Force

dotnet publish $project -c $Configuration -r $Runtime --self-contained true `
    -p:PublishSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:EnableCompressionInSingleFile=true `
    -p:DebugType=None `
    -o $outputPath

Get-ChildItem $outputPath -Filter *.pdb -ErrorAction SilentlyContinue | Remove-Item -Force

$exe = Join-Path $outputPath "FluentSSH.exe"
if (-not (Test-Path $exe)) {
    throw "Publish completed but FluentSSH.exe was not produced."
}

$zip = Join-Path $root "dist\FluentSSH-native-win-x64.zip"
if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $outputPath "*") -DestinationPath $zip -CompressionLevel Optimal

Write-Host ""
Write-Host "Native executable: $exe"
Write-Host "Portable archive:  $zip"
