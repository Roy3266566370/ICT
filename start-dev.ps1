param([switch]$Restart)
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$env:OLLAMA_MODELS = Join-Path $taskRoot 'models/ollama'
try { $null = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/version' -TimeoutSec 3 }
catch {
    $localOllama = Join-Path $taskRoot 'tools/ollama/ollama.exe'
    if (Test-Path -LiteralPath $localOllama) {
        $env:OLLAMA_HOST = '127.0.0.1:11434'
        Start-Process -FilePath $localOllama -ArgumentList 'serve' -WindowStyle Hidden
    } else { Write-Warning 'Ollama is unavailable. Install it to use local question understanding.' }
}
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

function Reset-StaleProcess([int]$Port, [string]$Name) {
    if (-not (Test-Listening $Port)) { return }
    $owners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($ownerPid in $owners) {
        if ($ownerPid -and $ownerPid -ne 0) {
            Write-Output "Port $Port is held by an unresponsive $Name process (PID $ownerPid); stopping it ..."
            Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue
        }
    }
    Start-Sleep -Seconds 1
}

function Show-LogTail([string]$Path, [string]$Label) {
    if (-not (Test-Path -LiteralPath $Path)) { return }
    Write-Output "--- last lines of $Label ---"
    Get-Content -LiteralPath $Path -Tail 15 | ForEach-Object { Write-Output $_ }
    Write-Output '--- end of log ---'
}

function Wait-Until([string]$Url, [int]$Seconds) {
    for ($i = 0; $i -lt $Seconds; $i++) {
        if (Test-Url $Url) { return $true }
        Start-Sleep -Seconds 1
    }
    return (Test-Url $Url)
}

# --- account route completeness check (read-only) ---------------------------
# The running backend on 8000 may be a stale process started before the account
# routes existed. "openapi.json answers 200" is NOT proof that the account API is
# served, so read the OpenAPI document and compare its paths. This check only
# issues HTTP GETs: it never stops, restarts or otherwise touches any process.
$RequiredRoutes = @(
    '/api/v1/auth/register',
    '/api/v1/auth/login',
    '/api/v1/auth/logout',
    '/api/v1/me'
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
        throw "无法验证账号路由：无法读取或解析 $BaseUrl/openapi.json。$($_.Exception.Message)"
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
        Write-Output "Account routes OK: all $($RequiredRoutes.Count) required account endpoints are served."
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
        ArgumentList           = $Arguments
        WorkingDirectory       = $WorkingDirectory
        WindowStyle            = 'Hidden'
        RedirectStandardOutput = $OutLog
        RedirectStandardError  = $ErrLog
    }
    try {
        Start-Process @parameters | Out-Null
    } catch [System.ArgumentException] {
        foreach ($name in @('http_proxy', 'https_proxy', 'no_proxy', 'all_proxy')) {
            [System.Environment]::SetEnvironmentVariable($name, $null)
        }
        Start-Process @parameters | Out-Null
    }
}

# --- restart ----------------------------------------------------------------
# Code changes are not hot-reloaded: without -Restart the script keeps the old
# backend because it already answers on 8000.
if ($Restart) {
    foreach ($port in @(8000, 5173)) {
        if (Test-Listening $port) {
            $owners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
                Select-Object -ExpandProperty OwningProcess -Unique
            foreach ($ownerPid in $owners) {
                if ($ownerPid -and $ownerPid -ne 0) {
                    Write-Output "Restart: stopping PID $ownerPid on port $port ..."
                    Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue
                }
            }
        }
    }
    Start-Sleep -Seconds 1
}

# --- backend ----------------------------------------------------------------
$backendUrl = 'http://127.0.0.1:8000/openapi.json'
if (Test-Url $backendUrl) {
    Write-Output 'Backend already running: http://127.0.0.1:8000/'
} else {
    Reset-StaleProcess 8000 'backend'
    $env:PYTHONUTF8 = '1'
    $env:PYTHONIOENCODING = 'utf-8'
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
    & py -3.11 -c "import fastapi, uvicorn, pptx, jsonschema" 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw 'Python 3.11 dependencies are missing. Run: py -3.11 -m pip install -r backend/requirements.txt'
    }
    Start-Detached -File 'py' -Arguments @('-3.11', '-u', 'backend/scripts/dev_run.py') `
        -WorkingDirectory $taskRoot `
        -OutLog (Join-Path $logRoot 'dev-backend.log') `
        -ErrLog $backendLog
    if (-not (Wait-Until $backendUrl 25)) {
        Show-LogTail $backendLog 'backend error log'
        throw 'Backend did not answer on 127.0.0.1:8000 within 25s. See the log above.'
    }
    # Freshly started backend: fail loudly if it came up without the account routes.
    Assert-RequiredRoutes 'http://127.0.0.1:8000'
    Write-Output 'Backend ready: http://127.0.0.1:8000/'
}

# Stale-process branch: the backend that already owns port 8000 may predate the
# account routes. Check right here so the script fails immediately instead of
# letting the frontend talk to a backend without /api/v1/auth/*.
Assert-RequiredRoutes 'http://127.0.0.1:8000'

# --- frontend ---------------------------------------------------------------
$frontendUrl = 'http://localhost:5173/'
if (Test-Url $frontendUrl) {
    Write-Output 'Frontend already running: http://localhost:5173/'
} else {
    Reset-StaleProcess 5173 'frontend'
    $nodeCommand = (Get-Command node -ErrorAction Stop).Source
    $frontendRoot = Join-Path $taskRoot 'frontend'
    if (-not (Test-Path -LiteralPath (Join-Path $frontendRoot 'node_modules/vite/bin/vite.js'))) {
        throw 'Frontend dependencies are missing. Run npm install in frontend first.'
    }
    Start-Detached -File $nodeCommand -Arguments @('node_modules/vite/bin/vite.js', '--port', '5173', '--strictPort') `
        -WorkingDirectory $frontendRoot `
        -OutLog (Join-Path $logRoot 'dev-frontend.log') `
        -ErrLog $frontendLog
    if (-not (Wait-Until $frontendUrl 25)) {
        Show-LogTail $frontendLog 'frontend error log'
        throw 'Frontend did not answer on localhost:5173 within 25s. See the log above.'
    }
    Write-Output 'Frontend ready: http://localhost:5173/'
}

Write-Output 'XiangSheng: http://localhost:5173/'
Write-Output 'Backend: http://127.0.0.1:8000/ (logs in verify/)'
