# macOS Build Runbook

## Full Build
- Frontend: `cd html && PATH=/Users/home/.nvm/versions/node/v24.12.0/bin:$PATH yarn build`
- Configure backend: `cmake -S . -B build '-UOPENSSL_*' '-U_OPENSSL_*' '-Upkgcfg_lib__OPENSSL_*' -DOPENSSL_ROOT_DIR="$(brew --prefix openssl@3)"`
- Build backend: `cmake --build build -j"$(sysctl -n hw.ncpu)"`
- Check binary: `./build/ttyd --version`

## OpenSSL Cache Error
- Symptom: `No rule to make target /opt/homebrew/Cellar/openssl@3/<old-version>/lib/libssl.dylib`.
- Cause: CMake cached a Homebrew Cellar version path that disappeared after OpenSSL upgrade.
- Fix: rerun the backend configure command above so CMake uses `/opt/homebrew/opt/openssl@3`.

## Port Already In Use
- Symptom: `lws_socket_bind: ERROR ... EADDRINUSE`.
- Check listener: `lsof -nP -iTCP:<port> -sTCP:LISTEN`.
- Use a different port: `./build/ttyd -p 8080 bash`.
- Stop the old listener only when safe: `kill <pid>`.

## Mobile Keyboard Verification
- After frontend changes, rebuild both `src/html.h` and `build/ttyd`.
- Start the rebuilt binary on a free port.
- On phone, force-refresh the page or reopen it to avoid stale cached JS.
- Tap the terminal area and verify the terminal rows shrink above the virtual keyboard.
- On Samsung Chrome, verify the terminal moves immediately after tap, before the first typed character.
- Dismiss the keyboard and verify the terminal returns to full height.
