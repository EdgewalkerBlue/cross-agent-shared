@echo off
rem Pi maintainability-gate entry (shared by any agent; PATH-independent)
rem Usage: pi-project "<project>" --check            (gate self-check, exit 1 on violation)
rem        pi-project "<project>" --ensure --refresh
rem        pi-project "<project>" --guard-staged     (pre-commit: staged forbidden files)
rem        pi-project "<project>" --guard-push       (pre-push: tracked forbidden files)
rem        pi-project "<project>" --untrack-forbidden
rem        pi-project --sync-global | --all
setlocal
set "PI_NODE=%USERPROFILE%\AppData\Local\pi-node\current\node.exe"
if not exist "%PI_NODE%" set "PI_NODE=node"
"%PI_NODE%" "%USERPROFILE%\.pi\agent\tools\project-init.mjs" %*
endlocal
