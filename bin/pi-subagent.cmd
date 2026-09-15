@echo off
rem Pi subagent dispatcher (shared by ZCode / WorkBuddy / any agent; PATH-independent)
rem Usage: pi-subagent --list
rem        pi-subagent --agent coder --task "<task>" --cwd "<project>" --json
setlocal
set "PI_NODE=%USERPROFILE%\AppData\Local\pi-node\current\node.exe"
if not exist "%PI_NODE%" set "PI_NODE=node"
"%PI_NODE%" "%USERPROFILE%\.pi\agent\tools\subagent-cli.mjs" %*
endlocal
