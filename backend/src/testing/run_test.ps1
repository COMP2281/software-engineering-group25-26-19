# run_all.ps1

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
Set-Location $BackendDir

$universities = @(
    #"University of Aberdeen",
    #"University of Bath",
    #"University of Birmingham",
    #"University of Bristol",
    #"University of Cambridge",
    #"Cardiff University",
    #"Durham University",
    #"The University of Edinburgh",
    #"University of Exeter",
    #"University of Glasgow",
    #"Imperial College London",
    #"King's College London, University of London (KCL)",
    #"Lancaster University",
    #"University of Leeds",
    #"University of Liverpool",
    #"Loughborough University",
    #"London School of Economics and Political Science, University of London (LSE)",
    #"University of Manchester",
    #"Newcastle University",
    #"Northumbria University, Newcastle",
    "University of Nottingham",
    "University of Oxford",
    "Queen Mary University of London",
    "Queen's University Belfast",
    "Royal Holloway, University of London",
    "University of Sheffield",
    "SOAS University of London",
    "University of Southampton",
    "University of St Andrews",
    "University of Sunderland",
    "University of Surrey",
    "University of Sussex",
    "UCL (University College London)",
    "University of Warwick",
    "University of York"
)

$timeoutSeconds = 60

foreach ($uni in $universities) {
    Write-Host "`n======================================================" -ForegroundColor Cyan
    Write-Host "Processing: $uni" -ForegroundColor Cyan
    Write-Host "======================================================" -ForegroundColor Cyan

    # Start the process using npx.cmd (required for Windows)
    # We wrap the university name in escaped quotes (`"$uni`")
    $process = Start-Process -FilePath "npx.cmd" -ArgumentList "ts-node", "src/scripts/test.ts", "`"$uni`"" -PassThru -NoNewWindow

    $sw =[Diagnostics.Stopwatch]::StartNew()
    $timedOut = $false

    # Monitor the process execution time
    while (-not $process.HasExited) {
        if ($sw.Elapsed.TotalSeconds -ge $timeoutSeconds) {
            $timedOut = $true
            Write-Host "`n[!] Timeout of ${timeoutSeconds}s reached for '$uni'. Terminating process tree..." -ForegroundColor Yellow
            
            # Use taskkill to forcefully (/F) kill the process and all its child processes (/T)
            # This ensures node.exe doesn't keep running in the background after npx is killed
            taskkill /PID $($process.Id) /T /F *>$null
            break
        }
        # Check every 500 milliseconds
        Start-Sleep -Milliseconds 500
    }

    $sw.Stop()

    if (-not $timedOut) {
        Write-Host "`n[+] Finished processing '$uni' in $([math]::Round($sw.Elapsed.TotalSeconds, 2)) seconds." -ForegroundColor Green
    }
    
    # Brief pause between universities to allow network sockets/DB connections to close gracefully
    Start-Sleep -Seconds 1
}

Write-Host "`n======================================================" -ForegroundColor Cyan
Write-Host "All universities processed." -ForegroundColor Green
Write-Host "======================================================" -ForegroundColor Cyan
