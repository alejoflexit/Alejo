# ── Paco flotante — mascota de Flexit siempre visible en pantalla ──
# Se lanza oculto con paco.vbs. Controles:
#   · Arrastrar con el mouse: lo movés a donde quieras (la posición se recuerda).
#   · Doble clic: abre la app Flexit.
#   · Clic derecho: menú con "Abrir Flexit" y "Cerrar a Paco".

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase

# Instancia única: si Paco ya está en pantalla, no abrir otro
$script:mutex = New-Object System.Threading.Mutex($false, 'PacoFlexitWidget')
if (-not $script:mutex.WaitOne(0, $false)) { exit }

$script:dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$script:posFile = Join-Path $env:APPDATA 'paco-flexit-pos.txt'
$script:appUrl = 'https://flota-logistica-iota.vercel.app/'

[xml]$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        WindowStyle="None" AllowsTransparency="True" Background="Transparent"
        Topmost="True" ShowInTaskbar="False" ResizeMode="NoResize"
        Width="100" Height="224" Title="Paco">
  <Image x:Name="img" Stretch="Uniform" />
</Window>
"@
$script:window = [Windows.Markup.XamlReader]::Load((New-Object System.Xml.XmlNodeReader $xaml))
$script:img = $script:window.FindName('img')

function Load-Frame([string]$name) {
  $bmp = New-Object System.Windows.Media.Imaging.BitmapImage
  $bmp.BeginInit()
  $bmp.UriSource = [Uri](Join-Path $script:dir $name)
  $bmp.CacheOption = [System.Windows.Media.Imaging.BitmapCacheOption]::OnLoad
  $bmp.EndInit()
  $bmp.Freeze()
  return $bmp
}
$script:frames = @( (Load-Frame 'paco-reposo.png'), (Load-Frame 'paco-levanta.png'), (Load-Frame 'paco-toma.png') )
$script:img.Source = $script:frames[0]

# Posición inicial: la última guardada, o abajo a la derecha
$wa = [System.Windows.SystemParameters]::WorkArea
$script:window.Left = $wa.Right - $script:window.Width - 24
$script:window.Top  = $wa.Bottom - $script:window.Height - 8
if (Test-Path $script:posFile) {
  try {
    $p = (Get-Content $script:posFile -Raw).Trim() -split ','
    $l = [double]$p[0]; $t = [double]$p[1]
    if ($l -gt -60 -and $t -gt -60 -and $l -lt ($wa.Right - 20) -and $t -lt ($wa.Bottom - 20)) {
      $script:window.Left = $l; $script:window.Top = $t
    }
  } catch { }
}

function Save-Pos {
  try { "$([int]$script:window.Left),$([int]$script:window.Top)" | Set-Content $script:posFile } catch { }
}

# Abrir Flexit: el acceso directo de la app instalada si existe; si no, Chrome en modo app
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$script:lnk = Get-ChildItem $startMenu -Recurse -Filter 'Flexit.lnk' -ErrorAction SilentlyContinue | Select-Object -First 1
function Open-Flexit {
  try {
    if ($script:lnk) { Start-Process $script:lnk.FullName; return }
    $chromes = @(
      (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
      (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
      (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    )
    foreach ($c in $chromes) {
      if ($c -and (Test-Path $c)) { Start-Process $c "--app=$($script:appUrl)"; return }
    }
    Start-Process $script:appUrl
  } catch { }
}

# Arrastrar / doble clic
$script:window.Add_MouseLeftButtonDown({
  param($s, $e)
  if ($e.ClickCount -ge 2) { Open-Flexit }
  else { try { $script:window.DragMove(); Save-Pos } catch { } }
})

# Menú de clic derecho
$menu = New-Object System.Windows.Controls.ContextMenu
$miOpen = New-Object System.Windows.Controls.MenuItem
$miOpen.Header = 'Abrir Flexit'
$miOpen.Add_Click({ Open-Flexit })
$miClose = New-Object System.Windows.Controls.MenuItem
$miClose.Header = 'Cerrar a Paco'
$miClose.Add_Click({ $script:window.Close() })
[void]$menu.Items.Add($miOpen)
[void]$menu.Items.Add($miClose)
$script:window.ContextMenu = $menu

# Animación (ticks de 500ms): reposo 10s → levanta → toma mate 2.5s → levanta → reposo
$script:seq = (,0 * 20) + ,1 + (,2 * 5) + ,1
$script:i = 0
$script:timer = New-Object System.Windows.Threading.DispatcherTimer
$script:timer.Interval = [TimeSpan]::FromMilliseconds(500)
$script:timer.Add_Tick({
  $script:i = ($script:i + 1) % $script:seq.Count
  $script:img.Source = $script:frames[$script:seq[$script:i]]
})
$script:timer.Start()

$script:window.Add_Closed({ Save-Pos; $script:timer.Stop() })
[void]$script:window.ShowDialog()
