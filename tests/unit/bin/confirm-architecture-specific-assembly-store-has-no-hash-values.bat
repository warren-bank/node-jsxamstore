@echo off

call "%~dp0.\_env.bat"

set log_file="%logs_dir%\%~n0.log"

node "%~dp0..\%~n0.js" -b %test_assembly_arm% >%log_file% 2>&1
