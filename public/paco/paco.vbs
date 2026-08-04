' Lanza el Paco flotante sin mostrar ninguna ventana de consola
Set fso = CreateObject("Scripting.FileSystemObject")
carpeta = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File """ & carpeta & "\paco-widget.ps1""", 0, False
