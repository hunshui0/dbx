$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$payload = Join-Path $repoRoot 'src-tauri/custom-resources'
$sourceJar = Join-Path $repoRoot 'agents/drivers/db2/build/libs/dbx-agent-db2.jar'
if (-not (Test-Path -LiteralPath $sourceJar)) { throw 'Build :db2:shadowJar before preparing the payload.' }
if (-not $env:JAVA_HOME) { throw 'JAVA_HOME must point to a JDK 21 installation.' }
$config = Get-Content (Join-Path $repoRoot 'src-tauri/tauri.custom.conf.json') -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Force -Path $payload | Out-Null
Copy-Item -LiteralPath $sourceJar -Destination (Join-Path $payload 'dbx-agent-db2.jar') -Force
$runtime = Join-Path $payload 'jre-21'
if (-not (Test-Path -LiteralPath $runtime)) {
    & (Join-Path $env:JAVA_HOME 'bin/jlink.exe') --add-modules java.se,jdk.crypto.ec,jdk.charsets,jdk.unsupported,jdk.naming.dns,jdk.localedata --strip-debug --no-header-files --no-man-pages --compress=zip-6 --output $runtime
    if ($LASTEXITCODE -ne 0) { throw 'jlink failed.' }
}
$modules = & (Join-Path $runtime 'bin/java.exe') --list-modules
if ($LASTEXITCODE -ne 0 -or -not ($modules -match '^jdk.charsets@21')) { throw 'The bundled Java 21 runtime must contain jdk.charsets.' }
$commit = (git -C $repoRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot determine source commit.' }
$manifest = [ordered]@{
    version = $config.version
    sourceCommit = $commit
    agentSha256 = (Get-FileHash -LiteralPath $sourceJar -Algorithm SHA256).Hash.ToLowerInvariant()
}
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $payload 'manifest.json') -Encoding utf8NoBOM
# Keep stdin open until the asynchronous RPC reply arrives; EOF cancels requests.
$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = Join-Path $runtime 'bin/java.exe'
$startInfo.ArgumentList.Add('-jar')
$startInfo.ArgumentList.Add((Join-Path $payload 'dbx-agent-db2.jar'))
$startInfo.UseShellExecute = $false
$startInfo.CreateNoWindow = $true
$startInfo.RedirectStandardInput = $true
$startInfo.RedirectStandardOutput = $true
$agent = [System.Diagnostics.Process]::new()
$agent.StartInfo = $startInfo
try {
    if (-not $agent.Start()) { throw 'Bundled DB2 Agent did not start.' }
    $ready = $agent.StandardOutput.ReadLineAsync()
    if (-not $ready.Wait(15000) -or -not ($ready.Result | ConvertFrom-Json).ready) { throw 'Agent not ready.' }
    $agent.StandardInput.WriteLine('{"jsonrpc":"2.0","id":1,"method":"handshake","params":{}}')
    $agent.StandardInput.Flush()
    $reply = $agent.StandardOutput.ReadLineAsync()
    if (-not $reply.Wait(15000)) { throw 'Agent handshake timed out.' }
    $response = $reply.Result | ConvertFrom-Json
    if (-not $response.result -or $response.error) { throw 'Bundled DB2 Agent handshake failed.' }
    $agent.StandardInput.WriteLine('{"jsonrpc":"2.0","id":2,"method":"shutdown","params":{}}')
    $agent.StandardInput.Flush()
    if (-not $agent.WaitForExit(10000) -or $agent.ExitCode -ne 0) { throw 'Agent shutdown failed.' }
} finally {
    if ($agent.Id -and -not $agent.HasExited) { $agent.Kill() }
    $agent.Dispose()
}
Write-Output "DB2 Agent ready: version=$($manifest.version) commit=$commit sha256=$($manifest.agentSha256)"
