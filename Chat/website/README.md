Website folder

- Place built installers in `website/downloads/` so the download page can link to them.
- Host this folder on GitHub Pages, Netlify, or any static host.

To add installers:
- Copy files into `website/downloads/` and commit.
- The `deploy-website.yml` workflow will publish `website/` to GitHub Pages when you push to `main` (requires `DEPLOY_KEY` secret or personal token setup).
