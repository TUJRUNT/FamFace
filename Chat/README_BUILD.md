# Build & Packaging Guide

This document describes how to build the Electron desktop app, prepare Capacitor for Android/iOS, and deploy the website.

Prerequisites
- Node.js (>=16) and npm installed
- For Electron builds: platform-specific SDKs (Windows: signtool optional; macOS: Xcode)
- For Android: Android SDK, Java JDK
- For iOS: Xcode and Apple Developer account (macOS required)

1) Install dependencies

```bash
npm install
cd Interior
npm install
```

2) Run locally

- Start server only:

```bash
npm run start
# (from Interior) runs server.js on port 3000
```

- Run Electron (dev):

```bash
cd Interior
npm run electron
```

3) Build Electron distributables (locally)

```bash
cd Interior
npm install --production
npm run dist
# artifacts created under Interior/dist or as configured in package.json
```

4) Capacitor (wrap PWA into native apps)

From project root:

```bash
# Install Capacitor globally or as dev dependency
npm install @capacitor/cli @capacitor/core --save-dev
npx cap init FamFace com.ahmed.famface --web-dir="."

# Add platforms
npx cap add android
npx cap add ios

# Build web assets
npm run build  # if you have a build step; for this project the web files are already in place

# Copy web assets to native platforms
npx cap copy

# Open Android Studio or Xcode
npx cap open android
npx cap open ios
```

Notes:
- Android builds require creating a signing key and configuring `build.gradle` for release.
- iOS builds require proper provisioning profiles and signing.

5) Publishing
- Electron: run `npm run dist` then upload the installers to your website and to GitHub Releases.
- Android: build a signed AAB/APK and upload to Google Play Console.
- iOS: archive and upload via Xcode to App Store Connect.
- PWA: host the site (GitHub Pages / Netlify / Vercel) and ensure `manifest.json` and `service-worker` are served over HTTPS.

6) CI/CD (recommended)
- Create GitHub Actions to run tests, build Electron artifacts, and publish to GitHub Releases.
- Use `peaceiris/actions-gh-pages` to publish the `website/` folder to GitHub Pages.

If you want, I can scaffold the GitHub Actions workflows and a sample Capacitor setup next.
