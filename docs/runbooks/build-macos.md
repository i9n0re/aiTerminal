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
- To keep a rebuilt ttyd running after this automation shell exits, start it inside a detached tmux session.
- Current binary requires client options as `-t key=value`, for example `-t fontSize=15`.

## Restart Local 8888 Server
- Check old listener: `lsof -nP -iTCP:8888 -sTCP:LISTEN`.
- Stop old listener when requested: `kill <pid>`.
- Start rebuilt ttyd in tmux: `tmux new-session -d -s ttyd-8888 'cd /Users/home/Documents/aiTerminal && env -u TMUX ./build/ttyd -W -c <credential> -p 8888 -t fontSize=15 env -u TMUX tmux a -t gemini'`.
- Verify: `lsof -nP -iTCP:8888 -sTCP:LISTEN` and `tmux capture-pane -pt ttyd-8888 -S -80`.

## Tmux Drawer Verification
- Confirm target windows: `tmux list-windows -t gemini -F '__TMUX_DATA__:#{window_index}:#{window_name}:#{window_active}'`.
- Open the right drawer and click refresh; expected list is the `gemini` window list regardless of recently used tmux session.

## Mobile Keyboard Verification
- After frontend changes, rebuild both `src/html.h` and `build/ttyd`.
- Start the rebuilt binary on a free port.
- On phone, force-refresh the page or reopen it to avoid stale cached JS.
- Tap the terminal area and verify the terminal rows shrink above the virtual keyboard.
- On Samsung Chrome, verify the terminal moves immediately after tap, before the first typed character.
- Dismiss the keyboard and verify the terminal returns to full height.
- With the keyboard closed, swipe inside tmux scrollback and verify the page does not shrink or jump upward.

## Mac App Backspace Verification
- Click outside the terminal hidden input so the terminal has no focused editable element.
- Press Backspace.
- Expected: the page should not navigate history or reset to the initial page; focus should return to xterm.
