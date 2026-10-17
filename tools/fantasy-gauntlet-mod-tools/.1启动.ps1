$toolDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $toolDir

if (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3 wf_gui.py
} else {
    & python wf_gui.py
}
