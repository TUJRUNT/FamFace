# FamFace Website

This folder contains a simple static website for distributing the packaged FamFace desktop application.

## How to use

1. Build the desktop app using:
   ```bash
   npm run dist
   ```
2. Copy the generated installer files from `dist/` into `website/downloads/`.
3. Open `website/index.html` in a browser, or host the `website/` folder on any static web server.

## Notes

- Windows installers should be named `FamFace Setup.exe`.
- macOS installers should be named `FamFace.dmg`.
- Linux installers should be named `FamFace.AppImage`.
