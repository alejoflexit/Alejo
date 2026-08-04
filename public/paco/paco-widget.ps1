# ── Paco flotante — mascota de Flexit siempre visible en pantalla ──
# Se lanza oculto con paco.vbs. Controles:
#   · Arrastrar con el mouse: lo movés a donde quieras (la posición se recuerda).
#   · Doble clic: abre la app Flexit.
#   · Clic derecho: menú con "Abrir Flexit" y "Cerrar a Paco".

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationFramework, PresentationCore, WindowsBase, System.Windows.Forms

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
  <Image x:Name="img" Stretch="Uniform" RenderOptions.BitmapScalingMode="HighQuality" />
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

# Abrir Flexit (con sección opcional vía #hash): Chrome en modo app; fallback navegador
$script:chrome = $null
foreach ($c in @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'))) {
  if ($c -and (Test-Path $c)) { $script:chrome = $c; break }
}
$startMenu = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
$script:lnk = Get-ChildItem $startMenu -Recurse -Filter 'Flexit.lnk' -ErrorAction SilentlyContinue | Select-Object -First 1
function Open-Url([string]$url) {
  try {
    if ($script:chrome) { Start-Process $script:chrome "--app=$url" } else { Start-Process $url }
  } catch { }
}
function Open-Flexit {
  try {
    if ($script:lnk) { Start-Process $script:lnk.FullName } else { Open-Url $script:appUrl }
  } catch { }
}

# Arrastre FLUIDO: movemos la ventana a mano en cada MouseMove (no usamos DragMove,
# que en Windows "ajustado para rendimiento" muestra solo un rectángulo)
$script:dragStart = $null
$script:window.Add_MouseLeftButtonDown({
  param($s, $e)
  if ($e.ClickCount -ge 2) { Open-Flexit; return }
  $cur = [System.Windows.Forms.Cursor]::Position
  $script:dragStart = @($cur.X, $cur.Y, $script:window.Left, $script:window.Top)
  [void]$script:window.CaptureMouse()
})
$script:window.Add_MouseMove({
  param($s, $e)
  if ($script:dragStart -and $e.LeftButton -eq [System.Windows.Input.MouseButtonState]::Pressed) {
    $cur = [System.Windows.Forms.Cursor]::Position
    $m = [System.Windows.PresentationSource]::FromVisual($script:window).CompositionTarget.TransformFromDevice
    $script:window.Left = $script:dragStart[2] + ($cur.X - $script:dragStart[0]) * $m.M11
    $script:window.Top  = $script:dragStart[3] + ($cur.Y - $script:dragStart[1]) * $m.M22
  }
})
$script:window.Add_MouseLeftButtonUp({
  if ($script:dragStart) {
    $script:dragStart = $null
    $script:window.ReleaseMouseCapture()
    Save-Pos
  }
})

# Menú de clic derecho: abrir + atajos por sección + cerrar
$menu = New-Object System.Windows.Controls.ContextMenu
$miOpen = New-Object System.Windows.Controls.MenuItem
$miOpen.Header = 'Abrir Flexit'
$miOpen.Add_Click({ Open-Flexit })
[void]$menu.Items.Add($miOpen)
[void]$menu.Items.Add((New-Object System.Windows.Controls.Separator))
$secciones = [ordered]@{
  'Pizarra' = 'pizarra'; 'Colectas' = 'colectas'; 'Métricas' = 'metricas'
}
foreach ($kv in $secciones.GetEnumerator()) {
  $mi = New-Object System.Windows.Controls.MenuItem
  $mi.Header = $kv.Key
  $mi.Tag = $kv.Value
  $mi.Add_Click({ param($ss, $ee) Open-Url ($script:appUrl + '#' + $ss.Tag) })
  [void]$menu.Items.Add($mi)
}
[void]$menu.Items.Add((New-Object System.Windows.Controls.Separator))
$miClose = New-Object System.Windows.Controls.MenuItem
$miClose.Header = 'Cerrar a Paco'
$miClose.Add_Click({ $script:window.Close() })
[void]$menu.Items.Add($miClose)
$script:window.ContextMenu = $menu

# Animación (ticks de 500ms): reposo 14s → levanta → toma mate 3s → levanta → reposo
$script:seq = (,0 * 28) + ,1 + (,2 * 6) + ,1
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
