param([switch]$Restart, [switch]$BackendOnly)
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$logRoot = Join-Path $taskRoot 'verify'
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
$backendLog = Join-Path $logRoot 'dev-backend-error.log'
$frontendLog = Join-Path $logRoot 'dev-frontend-error.log'

function Test-Listening([int]$Port) {
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

# HTTP probe that ignores system proxies.
# "Port is open" does not mean "service is alive": a process that was killed but not
# reaped can keep the socket bound, and Vite then answers every /api call with
# 500 text/plain (that is the "服务返回 500 (text/plain)" symptom).
function Test-Url([string]$Url) {
    try {
        $request = [System.Net.HttpWebRequest]::Create($Url)
        $request.Proxy = $null
        $request.Timeout = 3000
        $request.ReadWriteTimeout = 3000
        $response = $request.GetResponse()
        $code = [int]$response.StatusCode
        $response.Close()
        return $code -lt 500
    } catch {
        return $false
    }
}

function Show-LogTail([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    Write-Output "--- last lines of $Label ---"
    Get-Content -LiteralPath $Path -Tail 15 | ForEach-Object { Write-Output $_ }
    Write-Output '--- end of log ---'
}

function Assert-PortOwner([int]$Port, [int]$ExpectedPid) {
    $owners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique)
    if ($owners.Count -ne 1 -or $owners[0] -ne $ExpectedPid) {
        throw "Port $Port does not belong to recorded PID $ExpectedPid. Refusing reuse/stop of unknown owner."
    }
}

function Assert-ManagedProcess($Record, [string]$Target) {
    if ($Record.protocol -ne 'ict-start-dev-v1' -or $Record.repo -ne $taskRoot -or
        $Record.target -ne $Target -or $Record.launch_id -notmatch '^[a-f0-9]{32}$') {
        throw 'Unverifiable repo process record. Refusing to stop or reuse it.'
    }
    $process = Get-Process -Id $Record.pid -ErrorAction Stop
    $null = $process.Handle # Hold the kernel object, so PID reuse cannot change our target.
    $info = Get-CimInstance Win32_Process -Filter "ProcessId = $($Record.pid)"
    if ($process.StartTime.ToUniversalTime().Ticks.ToString() -ne $Record.started_ticks -or
        -not $info.ExecutablePath -or $info.ExecutablePath -ne $Record.executable -or
        $info.CommandLine -cne $Record.command_line -or
        $info.CommandLine.IndexOf($Target, [StringComparison]::OrdinalIgnoreCase) -lt 0 -or
        $info.CommandLine.IndexOf($Record.launch_id, [StringComparison]::Ordinal) -lt 0) {
        throw "PID $($Record.pid) no longer matches its repo/start/command identity. Refusing to stop or reuse it."
    }
    return $process
}

function Get-ManagedRecord([int]$Port, [string]$StatePath, [string]$Target) {
    $listening = Test-Listening $Port
    if (-not (Test-Path -LiteralPath $StatePath)) {
        if ($listening) { throw "Unknown owner on port $Port (no repo launch record). Stop it manually or choose another port; -Restart will not kill it." }
        return $null
    }
    # PowerShell 7 writes UTF-8 without a BOM. Windows PowerShell 5.1 must decode it explicitly.
    $record = Get-Content -LiteralPath $StatePath -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $listening -and -not (Get-Process -Id $record.pid -ErrorAction SilentlyContinue)) { return $null }
    $null = Assert-ManagedProcess $record $Target
    if ($listening) { Assert-PortOwner $Port $record.pid }
    return $record
}

function New-ProcessRecord($Process, [string]$LaunchId, [string]$Target) {
    $info = Get-CimInstance Win32_Process -Filter "ProcessId = $($Process.Id)"
    $record = [pscustomobject]@{
        protocol = 'ict-start-dev-v1'; repo = $taskRoot; pid = $Process.Id
        started_ticks = $Process.StartTime.ToUniversalTime().Ticks.ToString()
        executable = $info.ExecutablePath; command_line = $info.CommandLine
        launch_id = $LaunchId; target = $Target
    }
    $null = Assert-ManagedProcess $record $Target
    return $record
}

function Stop-OwnedTree([System.Diagnostics.Process]$Process) {
    # Only a newly created process handle or an OS-verified saved record gets here.
    if (-not $Process.HasExited) {
        & taskkill.exe /PID $Process.Id /T /F | Out-Null
        if ($LASTEXITCODE -ne 0 -and -not $Process.HasExited) { throw "Could not stop owned PID $($Process.Id)" }
        if (-not $Process.WaitForExit(10000)) { throw "Owned PID $($Process.Id) did not exit" }
    }
}

function Assert-BackendIdentity($Record) {
    & $pythonExe $backendTarget --check-url 'http://127.0.0.1:8000' --launch-id $Record.launch_id --expected-pid $Record.pid
    if ($LASTEXITCODE -ne 0) { throw 'Backend identity/source verification failed. Source changes require .\start-dev.ps1 -Restart; unknown processes must be stopped manually.' }
}

function Wait-OwnedService($Process, [int]$Port, [string]$Url, $Record) {
    $deadline = [DateTime]::UtcNow.AddSeconds(25)
    while ([DateTime]::UtcNow -lt $deadline) {
        if ($Process.HasExited) { throw "New process $($Process.Id) exited ($($Process.ExitCode)) before readiness." }
        if (Test-Listening $Port) {
            Assert-PortOwner $Port $Process.Id
            if ($null -ne $Record) { Assert-BackendIdentity $Record; return }
            if (Test-Url $Url) {
                if ($Process.HasExited) { throw 'New frontend exited during readiness check.' }
                Assert-PortOwner $Port $Process.Id
                return
            }
        }
        Start-Sleep -Milliseconds 200
    }
    throw "New service on port $Port did not become ready within 25s."
}

# --- required API route completeness check (read-only) ----------------------
# The running backend on 8000 may be a stale process started before the account
# routes existed. "openapi.json answers 200" is NOT proof that the account API is
# served, so read the OpenAPI document and compare its paths. This check only
# issues HTTP GETs: it never stops, restarts or otherwise touches any process.
$RequiredRoutes = @(
    '/api/v1/auth/register',
    '/api/v1/auth/login',
    '/api/v1/auth/logout',
    '/api/v1/me',
    '/api/v1/plaza',
    '/api/v1/creators/{user_id}',
    '/api/v1/p/{share_id}/fork'
)

function Get-OpenApiPaths([string]$BaseUrl) {
    $response = $null
    $reader = $null
    try {
        $request = [System.Net.HttpWebRequest]::Create("$BaseUrl/openapi.json")
        $request.Proxy = $null
        $request.Timeout = 5000
        $request.ReadWriteTimeout = 5000
        $response = $request.GetResponse()
        $stream = $response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $body = $reader.ReadToEnd()
        # ConvertFrom-Json unwraps a single-element root array. Check its JSON
        # root before parsing; this also works in Windows PowerShell 5.1.
        if (-not $body.TrimStart().StartsWith('{')) {
            throw 'OpenAPI document root must be an object.'
        }
        $document = $body | ConvertFrom-Json -ErrorAction Stop
        if ($document -isnot [System.Management.Automation.PSCustomObject] -or
            $document.PSObject.Properties.Name -cnotcontains 'paths' -or
            $document.paths -isnot [System.Management.Automation.PSCustomObject]) {
            throw 'OpenAPI document must contain a paths object.'
        }
        return @($document.paths.PSObject.Properties.Name)
    } catch {
        throw "无法验证必要路由：无法读取或解析 $BaseUrl/openapi.json。$($_.Exception.Message)"
    } finally {
        if ($null -ne $reader) { $reader.Dispose() }
        if ($null -ne $response) { $response.Close() }
    }
}

function Assert-RequiredRoutes([string]$BaseUrl) {
    # A failed read/parse is an error, never permission to skip verification.
    # Capture an empty paths object as an empty array so it reports missing routes.
    $paths = @(Get-OpenApiPaths $BaseUrl)
    $missing = @($RequiredRoutes | Where-Object { $paths -cnotcontains $_ })
    if ($missing.Count -eq 0) {
        Write-Output "API routes OK: all $($RequiredRoutes.Count) required endpoints are served."
        return
    }
    Write-Output "缺少账号路由：$($missing -join ', ')"
    Show-LogTail $backendLog 'backend error log'
    throw "Backend is missing account routes ($($missing -join ', ')). 请运行 .\start-dev.ps1 -Restart 重新加载后端代码。"
}

# Start-Process copies the environment block into a case-insensitive dictionary.
# If a shell exported both HTTPS_PROXY and https_proxy (proxy tools often do), that
# copy throws "duplicate key". Drop the lowercase twins once and retry.
function Start-Detached([string]$File, [string[]]$Arguments, [string]$WorkingDirectory, [string]$OutLog, [string]$ErrLog) {
    $parameters = @{
        FilePath               = $File
        # Start-Process joins ArgumentList without quoting; keep absolute paths with spaces intact.
        ArgumentList           = ($Arguments | ForEach-Object { '"' + $_ + '"' }) -join ' '
        PassThru               = $true
        WorkingDirectory       = $WorkingDirectory
        WindowStyle            = 'Hidden'
        RedirectStandardOutput = $OutLog
        RedirectStandardError  = $ErrLog
    }
    try {
        return Start-Process @parameters
    } catch [System.ArgumentException] {
        foreach ($name in @('http_proxy', 'https_proxy', 'no_proxy', 'all_proxy')) {
            [System.Environment]::SetEnvironmentVariable($name, $null)
        }
        return Start-Process @parameters
    }
}

# Resolve py once; never detach the py launcher (its child owns the socket).
$env:PYTHONUTF8 = '1'
$env:PYTHONIOENCODING = 'utf-8'
$pythonExe = & py -3.11 -c 'import sys; print(sys.executable)'
if ($LASTEXITCODE -ne 0 -or -not $pythonExe) { throw 'Python 3.11 is required.' }
$pythonExe = $pythonExe.Trim()
$backendTarget = Join-Path $taskRoot 'backend/scripts/dev_run.py'
$frontendRoot = Join-Path $taskRoot 'frontend'
$frontendTarget = Join-Path $frontendRoot 'node_modules/vite/bin/vite.js'
$backendState = Join-Path $logRoot 'dev-backend-process.json'
$frontendState = Join-Path $logRoot 'dev-frontend-process.json'

# Validate the ownership of each selected service before stopping anything.
$backendRecord = Get-ManagedRecord 8000 $backendState $backendTarget
if (-not $BackendOnly) { $frontendRecord = Get-ManagedRecord 5173 $frontendState $frontendTarget }
if ($Restart) {
    foreach ($record in @($backendRecord, $frontendRecord)) {
        if ($null -ne $record) {
            $owned = Assert-ManagedProcess $record $record.target
            Stop-OwnedTree $owned
        }
    }
    $backendRecord = $frontendRecord = $null
}

$created = @()
$createdStates = @()
$success = $false
try {
if ($null -ne $backendRecord) {
    Assert-PortOwner 8000 $backendRecord.pid
    Assert-BackendIdentity $backendRecord
    Write-Output 'Backend identity and source verified: http://127.0.0.1:8000/'
} else {
    if (Test-Listening 8000) { throw 'Port 8000 became occupied; refusing to start or kill its owner.' }
    # Keep local visitor cookies valid across development server restarts.
    if (-not $env:SESSION_SECRET) {
        New-Item -ItemType Directory -Force -Path (Join-Path $taskRoot 'backend/data') | Out-Null
        $secretPath = Join-Path $taskRoot 'backend/data/.dev-session-secret'
        if (-not (Test-Path -LiteralPath $secretPath)) {
            $secretBytes = New-Object byte[] 32
            $random = [System.Security.Cryptography.RandomNumberGenerator]::Create()
            $random.GetBytes($secretBytes)
            $random.Dispose()
            [Convert]::ToBase64String($secretBytes) | Set-Content -LiteralPath $secretPath -Encoding Ascii -NoNewline
        }
        $env:SESSION_SECRET = (Get-Content -LiteralPath $secretPath -Raw).Trim()
    }
    & $pythonExe -c "import fastapi, uvicorn, pptx, jsonschema" 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw 'Python 3.11 dependencies are missing. Run: py -3.11 -m pip install -r backend/requirements.txt'
    }
    $launchId = [Guid]::NewGuid().ToString('N')
    $backendProcess = Start-Detached -File $pythonExe -Arguments @('-u', $backendTarget, '--launch-id', $launchId) `
        -WorkingDirectory $taskRoot `
        -OutLog (Join-Path $logRoot 'dev-backend.log') `
        -ErrLog $backendLog
    $created += $backendProcess
    $null = $backendProcess.Handle
    $backendRecord = New-ProcessRecord $backendProcess $launchId $backendTarget
    $backendRecord | ConvertTo-Json | Set-Content -LiteralPath $backendState -Encoding UTF8
    $createdStates += $backendState
    Wait-OwnedService $backendProcess 8000 'http://127.0.0.1:8000/' $backendRecord
    Write-Output "New backend ready (PID $($backendRecord.pid), launch $launchId): http://127.0.0.1:8000/"
}
Assert-RequiredRoutes 'http://127.0.0.1:8000'
if ($BackendOnly) {
    $success = $true
    Write-Output 'Backend: http://127.0.0.1:8000/ (logs and process identity in verify/)'
    return
}

# --- frontend ---------------------------------------------------------------
$frontendUrl = 'http://localhost:5173/'
if ($null -ne $frontendRecord) {
    Assert-PortOwner 5173 $frontendRecord.pid
    if (-not (Test-Url $frontendUrl)) { throw 'Recorded frontend is unresponsive; use -Restart.' }
    Write-Output 'Frontend process verified: http://localhost:5173/'
} else {
    if (Test-Listening 5173) { throw 'Port 5173 became occupied; refusing to start or kill its owner.' }
    $nodeCommand = (Get-Command node -ErrorAction Stop).Source
    if (-not (Test-Path -LiteralPath $frontendTarget)) {
        throw 'Frontend dependencies are missing. Run npm install in frontend first.'
    }
    $launchId = [Guid]::NewGuid().ToString('N')
    $frontendProcess = Start-Detached -File $nodeCommand -Arguments @("--title=ict-dev-$launchId", $frontendTarget, '--port', '5173', '--strictPort') `
        -WorkingDirectory $frontendRoot `
        -OutLog (Join-Path $logRoot 'dev-frontend.log') `
        -ErrLog $frontendLog
    $created += $frontendProcess
    $null = $frontendProcess.Handle
    $frontendRecord = New-ProcessRecord $frontendProcess $launchId $frontendTarget
    $frontendRecord | ConvertTo-Json | Set-Content -LiteralPath $frontendState -Encoding UTF8
    $createdStates += $frontendState
    Wait-OwnedService $frontendProcess 5173 $frontendUrl $null
    Write-Output 'New frontend ready: http://localhost:5173/'
}
$success = $true
Write-Output 'XiangSheng: http://localhost:5173/'
Write-Output 'Backend: http://127.0.0.1:8000/ (logs and process identity in verify/)'
} catch {
    Show-LogTail $backendLog 'backend error log'
    Show-LogTail $frontendLog 'frontend error log'
    throw
} finally {
    if (-not $success) {
        $cleanupErrors = @()
        foreach ($process in $created) {
            try { Stop-OwnedTree $process } catch { $cleanupErrors += $_.Exception.Message }
        }
        if ($cleanupErrors.Count -gt 0) {
            throw "Owned process cleanup failed; keeping records for recovery: $($cleanupErrors -join '; ')"
        }
        foreach ($path in $createdStates) { Remove-Item -LiteralPath $path -ErrorAction SilentlyContinue }
    }
}
