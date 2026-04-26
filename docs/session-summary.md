# Session Summary

## 2026-04-26
- Fixed mobile keyboard overlap by resizing the terminal shell to `window.visualViewport` and refitting xterm after viewport changes.
- Changed sidebar and quick-key positioning to stay inside the resized terminal shell.
- Regenerated `src/html.h` with `yarn build`.
- Verified build success using nvm Node with PATH override.
- Fixed stale macOS CMake OpenSSL cache and rebuilt `build/ttyd`.
- Added second-pass mobile keyboard avoidance: viewport meta `interactive-widget=resizes-content`, VirtualKeyboard API support, focus/touch-triggered repeated xterm refits, and fallback keyboard inset for browsers that do not report viewport shrink.
- Added third-pass Samsung Chrome fix: terminal touch immediately reserves estimated keyboard height, then real viewport shrink offsets that estimate. Also changed terminal/page background from pure black to deep gray and adjusted xterm colors.
- Added fourth-pass Samsung Chrome fix: terminal touch focuses xterm first, then delays the estimated keyboard inset so the first tap can open the keyboard; viewport restoration clears the inset after keyboard dismissal. Reverted colors to the original xterm theme.
