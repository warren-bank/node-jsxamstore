@echo off

set node_jsxamstore_test_dir=%~dp0..\..\..\..\..\node-jsxamstore-test
set node_jsxamstore_test_data=%node_jsxamstore_test_dir%\data\02-blobs-original\assemblies

set test_assembly_primary="%node_jsxamstore_test_data%\assemblies.blob"
set test_assembly_arm="%node_jsxamstore_test_data%\assemblies.armeabi_v7a.blob"

set logs_dir=%~dp0..\logs

if not exist "%logs_dir%" mkdir "%logs_dir%"
