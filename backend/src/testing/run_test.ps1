param(
    [Parameter(ValueFromRemainingArguments = $true)]
    [string[]]$ManagerArgs
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
Set-Location $BackendDir

$DefaultTimeoutSeconds = 1800
$TimeoutSeconds = if ($env:TIMEOUT_SECONDS) { [int]$env:TIMEOUT_SECONDS } else { $DefaultTimeoutSeconds }

function Show-Usage {
    Write-Host @"
Usage:
  .\src\testing\run_test.ps1 [timeout_seconds] --universityIds="UNIVERSITY_ID" [manager args...]
  .\src\testing\run_test.ps1 --universityIds="UNIVERSITY_ID" [manager args...]

Examples:
  .\src\testing\run_test.ps1 --universityIds="1c08965e-a829-483e-9417-3f4f602af357"
  .\src\testing\run_test.ps1 --universityIds="1c08965e-a829-483e-9417-3f4f602af357" --q="Advanced Computing"
  .\src\testing\run_test.ps1 900 --universityIds="1c08965e-a829-483e-9417-3f4f602af357" --q="Advanced Computing"

Notes:
  - Arguments after the optional timeout are passed directly to src/scrapers/manager.ts.
  - Use npx prisma studio to find university IDs.
  - Set TIMEOUT_SECONDS=0 to disable timeout.
"@
}

if ($ManagerArgs.Count -gt 0 -and ($ManagerArgs[0] -eq "--help" -or $ManagerArgs[0] -eq "-h")) {
    Show-Usage
    exit 0
}

if ($ManagerArgs.Count -gt 0 -and $ManagerArgs[0] -match '^\d+$') {
    $TimeoutSeconds = [int]$ManagerArgs[0]
    $ManagerArgs = if ($ManagerArgs.Count -gt 1) { $ManagerArgs[1..($ManagerArgs.Count - 1)] } else { @() }
}

if ($ManagerArgs.Count -eq 0) {
    Write-Host "Error: no manager arguments provided." -ForegroundColor Red
    Show-Usage
    exit 1
}

$HasUniversityIds = $false
foreach ($arg in $ManagerArgs) {
    if ($arg -like "--universityIds=*") {
        $HasUniversityIds = $true
        break
    }
}

if (-not $HasUniversityIds) {
    Write-Host "Error: --universityIds is required." -ForegroundColor Red
    Write-Host "Use 'npx prisma studio' to find the university ID." -ForegroundColor Yellow
    Show-Usage
    exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "Error: node is not installed or not in PATH." -ForegroundColor Red
    exit 1
}

$NodeCheck = @'
const [maj, min, patch] = process.versions.node.split('.').map(Number);
const ok = (maj === 20 && (min > 18 || (min === 18 && patch >= 1))) || (maj >= 22 && (maj > 22 || min >= 3));
process.exit(ok ? 0 : 1);
'@
node -e $NodeCheck
if ($LASTEXITCODE -ne 0) {
    $CurrentNode = node -v
    Write-Host "Error: Unsupported Node version $CurrentNode." -ForegroundColor Red
    Write-Host "This backend needs Node >=20.18.1 (<21) or >=22.3.0." -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path "node_modules")) {
    Write-Host "[!] node_modules not found in backend/." -ForegroundColor Yellow
    Write-Host "[!] Run 'npm install' in backend first for stable local execution." -ForegroundColor Yellow
}

if (-not $env:DATABASE_URL -and -not (Test-Path ".env")) {
    Write-Host "Error: DATABASE_URL is not set." -ForegroundColor Red
    Write-Host "Create backend/.env from .env.example and set DATABASE_URL." -ForegroundColor Yellow
    exit 1
}

$TsNodeCmd = if (Test-Path ".\node_modules\.bin\ts-node.cmd") {
    ".\node_modules\.bin\ts-node.cmd"
} else {
    if (-not (Get-Command npx.cmd -ErrorAction SilentlyContinue)) {
        Write-Host "Error: npx.cmd is not installed or not in PATH." -ForegroundColor Red
        exit 1
    }
    "npx.cmd"
}

$ProcessArgs = if ($TsNodeCmd -eq "npx.cmd") {
    @("ts-node", "src/scrapers/manager.ts") + $ManagerArgs
} else {
    @("src/scrapers/manager.ts") + $ManagerArgs
}

function ConvertTo-ProcessArgument {
    param([string]$Value)

    if ($Value -notmatch '[\s"]') {
        return $Value
    }

    return '"' + ($Value -replace '\\', '\\' -replace '"', '\"') + '"'
}

$ProcessArgumentString = ($ProcessArgs | ForEach-Object { ConvertTo-ProcessArgument $_ }) -join " "

Write-Host "`n======================================================" -ForegroundColor Cyan
Write-Host "Running scraper manager" -ForegroundColor Cyan
Write-Host "======================================================" -ForegroundColor Cyan
Write-Host "Command: $TsNodeCmd $ProcessArgumentString"

$Stopwatch = [Diagnostics.Stopwatch]::StartNew()
$TimedOut = $false
$Process = Start-Process -FilePath $TsNodeCmd -ArgumentList $ProcessArgumentString -PassThru -NoNewWindow

try {
    while (-not $Process.HasExited) {
        if ($TimeoutSeconds -gt 0 -and $Stopwatch.Elapsed.TotalSeconds -ge $TimeoutSeconds) {
            $TimedOut = $true
            Write-Host "`n[!] Timeout of ${TimeoutSeconds}s reached. Terminating process tree..." -ForegroundColor Yellow
            taskkill /PID $($Process.Id) /T /F *>$null
            break
        }
        Start-Sleep -Milliseconds 500
    }
} finally {
    $Stopwatch.Stop()
}

if ($TimedOut) {
    Write-Host "`n[!] Scraper timed out after $([math]::Round($Stopwatch.Elapsed.TotalSeconds, 2)) seconds." -ForegroundColor Yellow
    exit 124
}

$ExitCode = $Process.ExitCode
if ($ExitCode -eq 0) {
    Write-Host "`n[+] Scraper finished in $([math]::Round($Stopwatch.Elapsed.TotalSeconds, 2)) seconds." -ForegroundColor Green
} else {
    Write-Host "`n[!] Scraper finished in $([math]::Round($Stopwatch.Elapsed.TotalSeconds, 2)) seconds with exit code $ExitCode." -ForegroundColor Yellow
}

exit $ExitCode
