# Installs ir, Iridium's program, on this Windows computer (docs/exec.md, installing). It only
# installs (or updates); the arguments given are then run as ir:
#   irm <this script> | iex                                                   installs ir
#   & ([scriptblock]::Create((irm <this script>))) start                      then: this computer's Iridium, run at login
#   & ([scriptblock]::Create((irm <this script>))) start --no-server --join <address>   then: an executor of that one
# Iridium {{RELEASE}}, from {{BASE}}, checked against that release's SHA256SUMS. In
# %LOCALAPPDATA%\Iridium (iridium.exe, ir.cmd; that folder on the user's Path), with Iridium in the
# Start menu. ASCII only (irm may read it in any code page).
& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
    $base = '{{BASE}}'
    $release = '{{RELEASE}}'
    $origin = '{{ORIGIN}}'
    $argv = @($args)
    $a = if (@($env:PROCESSOR_ARCHITEW6432, $env:PROCESSOR_ARCHITECTURE) -contains 'ARM64') { 'arm64' } else { 'amd64' }
    $prefix = Join-Path $env:LOCALAPPDATA 'Iridium'
    $exe = Join-Path $prefix 'iridium.exe'
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('iridium-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $tmp, $prefix | Out-Null
    try {
        function Get-File($name) {
            $out = Join-Path $tmp $name
            if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
                curl.exe -fL --progress-bar -o $out ($base + $name)
                if ($LASTEXITCODE) { throw "download failed: $base$name" }
            } else { Invoke-WebRequest -UseBasicParsing -Uri ($base + $name) -OutFile $out }
            $out
        }
        $sums = Get-Content (Get-File 'SHA256SUMS')
        $archive = "iridium-windows-$a.tar.gz"
        Write-Host "Installing Iridium $release (windows/$a)"
        $file = Get-File $archive
        $want = ($sums | Where-Object { ($_ -split '\s+')[1] -in @($archive, "*$archive") } | Select-Object -First 1) -split '\s+' | Select-Object -First 1
        $got = (Get-FileHash -Algorithm SHA256 $file).Hash.ToLower()
        if (-not $want -or $got -ne $want.ToLower()) { throw "$archive does not match SHA256SUMS: not installed" }
        # Windows 10 and later have tar.exe (bsdtar).
        tar.exe -xzf $file -C $tmp ./iridium.exe
        if ($LASTEXITCODE) { throw "could not unpack $archive" }
        # A running iridium.exe cannot be replaced, only renamed.
        if (Test-Path $exe) {
            Get-ChildItem -Path $prefix -Filter 'iridium.exe.old*' -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
            Move-Item -Force $exe ("$exe.old." + [DateTime]::UtcNow.Ticks)
        }
        Move-Item -Force (Join-Path $tmp 'iridium.exe') $exe
    } finally {
        Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    }
    # ir: ir.cmd beside it, that folder on the user's Path (and this session's).
    [IO.File]::WriteAllText((Join-Path $prefix 'ir.cmd'), "@`"$exe`" ir %*`r`n")
    $path = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not (($path -split ';') -contains $prefix)) {
        [Environment]::SetEnvironmentVariable('Path', ((@($path -split ';') + $prefix) | Where-Object { $_ }) -join ';', 'User')
    }
    if (-not (($env:Path -split ';') -contains $prefix)) { $env:Path = "$env:Path;$prefix" }
    # Iridium in the Start menu.
    try {
        $lnk = Join-Path ([Environment]::GetFolderPath('Programs')) 'Iridium.lnk'
        $s = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
        $s.TargetPath = $exe
        $s.WorkingDirectory = $prefix
        $s.Save()
    } catch { Write-Host "No Start menu entry: $_" }
    # Not exit: run through iex, that would close the person's window.
    if ($argv.Count) {
        & $exe ir @argv
        return
    }
    Write-Host "Installed: $exe"
    Write-Host 'Next:'
    Write-Host '  ir start                      this computer''s Iridium (run at login)'
    if ($origin) { Write-Host "  ir start --no-server --join $origin   an executor of $origin only" }
    else { Write-Host '  ir start --no-server --join <address>   an executor of that one only' }
    Write-Host '  ir status'
} @args
