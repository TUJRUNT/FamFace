# Store Assets Checklist

Prepare these assets before submitting to app stores or publishing the website download page.

Required assets
- App name and short name
- Icon sizes: 48, 72, 96, 144, 192, 512 (PNG/SVG)
- Feature graphic / banner (Google Play)
- App screenshots (phone/tablet) — several resolutions
- Short description (80 chars) and full description
- Privacy policy URL
- Support contact email and website URL
- Promotional video (optional)

Desktop installers
- Windows: NSIS installer (.exe) and portable variants
- macOS: .dmg and notarized package (if distributing outside App Store)
- Linux: AppImage and .deb/.rpm (optional)

Metadata
- Release notes
- What's new text for releases

Design tips
- Use transparent or solid backgrounds depending on store guidelines
- Provide high-quality screenshots and localize text for target markets

Security & signing
- Windows: code signing certificate for a trusted installer experience
- macOS: Apple Developer ID + notarization to avoid download warnings
- Android: signing key (keystore) to upload to Google Play

Upload locations
- Host installers in `website/downloads/` and link from the download page
- Use GitHub Releases to attach artifacts and link from your website
