# iridium from the Iridium at {{ORIGIN}} (docs/exec.md, the one line), run on this Windows computer as
# the address asked, from cmd or PowerShell:
#   powershell -c "irm {{ORIGIN}}/join.ps1 | iex"             agents run here for it while this window stays open
#   powershell -c "irm '{{ORIGIN}}/join.ps1?install' | iex"   the same, installed to run at login
#   powershell -c "irm {{ORIGIN}}/install.ps1 | iex"          an Iridium of this computer's own, run at login
# It fetches iridium.exe (this Iridium's version, its archive checked there against the release's
# SHA256SUMS) into %LOCALAPPDATA%\iridium\cache, again only when that version is another.
# ASCII only (irm may read it in any code page): the arguments come as base64 of UTF-8.
& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
    $a = if (@($env:PROCESSOR_ARCHITEW6432, $env:PROCESSOR_ARCHITECTURE) -contains 'ARM64') { 'arm64' } else { 'amd64' }
    $dir = Join-Path $env:LOCALAPPDATA 'iridium\cache'
    $exe = Join-Path $dir 'iridium.exe'
    $want = '{{WANT}}'
    $have = ''
    if (Test-Path $exe) { try { $have = "$(& $exe version)".Trim() } catch { } }
    if (-not $want -or $have -ne $want) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        Write-Host "Downloading $(if ($want) { $want } else { 'iridium' })"
        $tgz = Join-Path $dir 'iridium.tar.gz'
        $url = "{{DOWNLOAD}}iridium-windows-$a.tar.gz"
        if (Get-Command curl.exe -ErrorAction SilentlyContinue) { curl.exe -fL --progress-bar -o $tgz $url; if ($LASTEXITCODE) { throw "download failed: $url" } }
        else { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $tgz }
        $new = Join-Path $dir 'new'
        if (Test-Path $new) { Remove-Item -Recurse -Force $new }
        New-Item -ItemType Directory -Force -Path $new | Out-Null
        # Windows 10 and later have tar.exe (bsdtar).
        tar.exe -xzf $tgz -C $new ./iridium.exe
        if ($LASTEXITCODE) { throw "could not unpack $tgz" }
        # A running iridium.exe cannot be replaced, only renamed.
        if (Test-Path $exe) { Remove-Item -Force "$exe.old" -ErrorAction SilentlyContinue; Move-Item -Force $exe "$exe.old" }
        Move-Item -Force (Join-Path $new 'iridium.exe') $exe
        Remove-Item -Recurse -Force $new, $tgz
    }
    $argv = @({{ARGS}}) | ForEach-Object { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($_)) }
    & $exe @argv
}
