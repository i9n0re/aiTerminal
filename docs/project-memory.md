# Project Memory

## Goal
- This project is a rewritten/forked ttyd with a customized web terminal frontend.

## Architecture
- Frontend source lives under `html/src`.
- `html/src/components/terminal/index.tsx` owns the Preact terminal shell, mobile toolbar, sidebar, and xterm mount point.
- `html/src/components/terminal/xterm/index.ts` wraps xterm.js and WebSocket terminal I/O.
- `yarn build` in `html/` runs webpack/gulp and regenerates the embedded frontend header at `src/html.h`.

## Environments
- Local shell PATH may pick broken Homebrew Node first. Use `PATH=/Users/home/.nvm/versions/node/v24.12.0/bin:$PATH` before frontend yarn commands in this environment.

## Important Paths
- `html/src/components/terminal/index.tsx`
- `html/src/components/terminal/xterm/index.ts`
- `html/src/style/index.scss`
- `src/html.h`

## Commands
- Frontend build: `cd html && PATH=/Users/home/.nvm/versions/node/v24.12.0/bin:$PATH yarn build`
- Frontend check: `cd html && PATH=/Users/home/.nvm/versions/node/v24.12.0/bin:$PATH yarn check`
- Backend configure on macOS: `cmake -S . -B build '-UOPENSSL_*' '-U_OPENSSL_*' '-Upkgcfg_lib__OPENSSL_*' -DOPENSSL_ROOT_DIR="$(brew --prefix openssl@3)"`
- Backend build: `cmake --build build -j"$(sysctl -n hw.ncpu)"`

## Constraints
- Keep generated `src/html.h` in sync when frontend changes need to be embedded into ttyd.

## Preferences
- Keep memory docs short and factual.
