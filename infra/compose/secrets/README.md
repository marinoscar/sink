# Secrets Directory

Files placed here are mounted read-only into the api container at `/run/secrets/`.
All files in this directory are git-ignored (only `.gitignore` and this `README.md` are tracked).

## Platform Authentication Cookies

Some videos require authentication to download (bot-gate, rate-limit, or login wall). If
yt-dlp reports "Sign in to confirm", "rate-limit reached", "login required", or similar
errors, you can provide session cookies for the affected platform.

Each platform has its own independent cookies file. Drop in only the file(s) you need.

| File | Platform |
|------|----------|
| `youtube-cookies.txt` | YouTube (`youtube.com`, `youtu.be`, `youtube-nocookie.com`) |
| `instagram-cookies.txt` | Instagram (`instagram.com`) |
| `tiktok-cookies.txt` | TikTok (`tiktok.com`) |
| `x-cookies.txt` | X / Twitter (`x.com`, `twitter.com`) |
| `facebook-cookies.txt` | Facebook (`facebook.com`, `fb.watch`) |

### How to export cookies

1. Install the Chrome extension **"Get cookies.txt LOCALLY"** by `kairi003`
   (search the Chrome Web Store; it is the most reliable exporter for the Netscape format).
2. Navigate to the platform and make sure you are logged in.
3. Click the extension icon and export cookies for the relevant domain.
4. Save the downloaded file using the name from the table above in this directory.

### Behavior

- The API checks for each file on every request — no restart required after dropping a file in.
- If a file is absent, behavior for that platform is unchanged.
- A file present for one platform is **never** passed to yt-dlp for a request to a different
  platform, limiting credential exposure.
- Cookies expire every few weeks (platforms rotate session tokens). If downloads start failing
  with a bot-gate error, re-export your cookies and replace the file.

### Security

- Each file grants access to your session on that platform — treat it as a credential.
- All files are git-ignored and never logged by the application.
- The container mounts this directory read-only.

See `docs/cookies.md` for full details.
