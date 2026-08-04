# Instalador remoto del Paco flotante — se corre con:
#   irm https://flota-logistica-iota.vercel.app/paco/instalar.ps1 | iex
# Descarga el widget a %LOCALAPPDATA%\PacoFlexit, lo agrega al inicio de Windows y lo abre.

$base = 'https://flota-logistica-iota.vercel.app/paco'
$dir = Join-Path $env:LOCALAPPDATA 'PacoFlexit'
New-Item -ItemType Directory -Force -Path $dir | Out-Null

foreach ($f in @('paco-widget.ps1','paco.vbs','mate-reposo.png','mate-levanta.png','mate-toma.png','paquete-reposo.png','paquete-lanza.png','paquete-recibe.png')) {
  Invoke-WebRequest -Uri "$base/$f" -OutFile (Join-Path $dir $f) -UseBasicParsing
}

$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Startup')) 'Paco Flexit.lnk'))
$s.TargetPath = 'wscript.exe'
$s.Arguments = '"' + (Join-Path $dir 'paco.vbs') + '"'
$s.WorkingDirectory = $dir
$s.Save()

Start-Process wscript.exe ('"' + (Join-Path $dir 'paco.vbs') + '"')
Write-Host ''
Write-Host 'Paco instalado: ya esta flotando y arranca solo con Windows.'
Write-Host 'Arrastralo para moverlo. Doble clic abre Flexit. Clic derecho > Cerrar a Paco.'
