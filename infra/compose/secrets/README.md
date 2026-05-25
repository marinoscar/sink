# Secrets Directory

Files placed here are mounted read-only into the api container at `/run/secrets/`.
All files in this directory are git-ignored (only `.gitignore` and this `README.md` are tracked).

## YouTube Authentication Cookies

Some YouTube videos require authentication to download (bot-gate). If yt-dlp reports
"Sign in to confirm" or similar errors, you can provide your YouTube session cookies.

### How to export your YouTube cookies

1. Install the Chrome extension **"Get cookies.txt LOCALLY"** by `kairi003`
   (search the Chrome Web Store; it is the most reliable exporter for the Netscape format).
2. Navigate to https://www.youtube.com and make sure you are logged in.
3. Click the extension icon and export cookies for `youtube.com`.
4. Save the downloaded file as `youtube-cookies.txt` in this directory.

### Behavior

- The API checks for the file on every request — no restart required after dropping the file in.
- If the file is absent, behavior is unchanged (some YouTube videos still work without auth).
- Cookies expire every few weeks (Google rotates session tokens). If downloads start failing
  with "Sign in to confirm", re-export your cookies and replace the file.

### Security

- This file grants access to your YouTube/Google session — treat it as a credential.
- It is git-ignored and never logged by the application.
- The container mounts this directory read-only.
