# This Windows computer runs agents for the Iridium at {{ORIGIN}} while this window stays open
# (docs/exec.md "ir-computer"), from cmd or PowerShell:
#   powershell -c "irm {{ORIGIN}}/join.ps1 | iex"
# It fetches ir-computer.exe (into %LOCALAPPDATA%\iridium\cache, again only when this Iridium's
# version is another) and runs it here: a pairing code to allow on the Iridium's page the first
# time, then connected till Ctrl-C or the window closes. Nothing starts at login.
# ASCII only (irm may read it in any code page): the arguments come as base64 of UTF-8.
& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
    $a = if (@($env:PROCESSOR_ARCHITEW6432, $env:PROCESSOR_ARCHITECTURE) -contains 'ARM64') { 'arm64' } else { 'amd64' }
    $dir = Join-Path $env:LOCALAPPDATA 'iridium\cache'
    $exe = Join-Path $dir 'ir-computer.exe'
    $want = '{{WANT}}'
    $have = ''
    if (Test-Path $exe) { try { $have = "$(& $exe version)".Trim() } catch { } }
    if (-not $want -or $have -ne $want) {
        New-Item -ItemType Directory -Force -Path $dir | Out-Null
        Invoke-WebRequest -UseBasicParsing -Uri "{{DOWNLOAD}}ir-computer-windows-$a.exe" -OutFile "$exe.new"
        Move-Item -Force "$exe.new" $exe
    }
    $argv = @({{ARGS}}) | ForEach-Object { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($_)) }
    & $exe @argv
}
