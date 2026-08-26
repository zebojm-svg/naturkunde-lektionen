# Startet das virtuelle Trennverfahren-Labor
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
Start-Process (Join-Path $here "labor-trennverfahren.html")
