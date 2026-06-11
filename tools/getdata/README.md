Bundled GetData launcher directory
=================================

Place a legally licensed copy of `GetData.exe` in this directory:

  tools/getdata/GetData.exe

Electron packaging copies this folder to the application resources directory.
The app detects this executable in development and packaged builds, and the
Meta image digitization review dialog can launch it directly.

At runtime, users can also click "选择 GetData.exe" in the Meta image
digitization review dialog. The app copies the selected executable into the
local writable data directory and detects it automatically.

The original GetData website may still show a download page while its installer
file returns 404. The UI therefore opens an available download page and then
guides the user to select the installed `GetData.exe`.

The binary is not committed here because GetData Graph Digitizer is third-party
software and must be distributed only under a valid license.
