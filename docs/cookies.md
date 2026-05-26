# Platform Authentication Cookies

## Why This Exists

Several supported platforms apply a bot-gate or login wall to certain content. When
yt-dlp encounters such a gate it prints a message such as "Sign in to confirm",
"rate-limit reached", or "login required" to stderr and exits non-zero. The API maps
this to a 422 response with the message:

> This video requires authentication cookies for \<platform\>. See docs/cookies.md for setup.

The only reliable bypass is to supply real session cookies for the affected platform.
Each platform has its own independent cookies file slot — you only need to drop in the
file(s) for the platform(s) you actually need.

## Supported Platform Cookie Files

All files live under `infra/compose/secrets/` and are mounted read-only into the API
container at `/run/secrets/`. Absent files are simply ignored.

| File | Platform |
|------|----------|
| `youtube-cookies.txt` | YouTube (`youtube.com`, `youtu.be`, `youtube-nocookie.com`) |
| `instagram-cookies.txt` | Instagram (`instagram.com`) |
| `tiktok-cookies.txt` | TikTok (`tiktok.com`) |
| `x-cookies.txt` | X / Twitter (`x.com`, `twitter.com`) |
| `facebook-cookies.txt` | Facebook (`facebook.com`, `fb.watch`) |

## Step-by-Step Cookie Export (any platform)

1. Install the Chrome extension **"Get cookies.txt LOCALLY"** by `kairi003`.
   Search the Chrome Web Store for the exact name. It exports cookies in the
   Netscape format that yt-dlp expects.

2. Navigate to the platform you need (e.g. https://www.youtube.com) and confirm
   you are logged in to the account you want to use.

3. Click the extension icon and choose to export cookies for the relevant domain
   (e.g. `youtube.com`, `instagram.com`, `tiktok.com`, `x.com`, or `facebook.com`).

4. Rename the downloaded file to the appropriate name from the table above and
   place it in:
   ```
   infra/compose/secrets/<platform>-cookies.txt
   ```

5. No restart is required. The API checks for each file on every request. Within
   seconds of dropping the file in, yt-dlp will start receiving the `--cookies` flag
   for that platform's URLs.

## File Format

Each file must be in **Netscape HTTP Cookie File** format. The first line should be:

```
# Netscape HTTP Cookie File
```

This is what "Get cookies.txt LOCALLY" and most other cookie exporters produce by default.

## Cookie Expiry

Platform session cookies expire periodically — typically every few weeks, though the
exact interval varies by platform. If downloads start failing again with a bot-gate error:

1. Re-export your cookies using the same steps above.
2. Replace the appropriate file in `infra/compose/secrets/`.
3. No restart required — the change takes effect immediately.

## Independence of Platform Files

Each platform's cookies file is completely independent:

- Dropping `youtube-cookies.txt` only affects YouTube requests.
- Dropping `instagram-cookies.txt` only affects Instagram requests.
- A file present for platform A is **never** passed to yt-dlp for a request to platform B.
  This limits credential exposure to the minimum required scope.

## Security Notes

- **Treat each file as a credential.** It grants access to your session on that platform.
  Anyone with the file can act as you on that platform.
- All files are git-ignored (`infra/compose/secrets/.gitignore` excludes all files except
  `.gitignore` and `README.md`). Never commit them.
- Inside the container the directory is mounted read-only at `/run/secrets/`.
- The application logs only the platform name and URL hostname when cookies are used — the
  cookies path and file contents are never written to logs.

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Still getting 422 "requires authentication cookies" | Cookies file not found at expected path | Verify the file is named correctly in `infra/compose/secrets/` |
| Still getting 422 after adding cookies | Cookies have expired | Re-export from browser |
| Still getting 422 after re-export | Wrong account | Log into the correct account before exporting |
| API container can't read the file | Mount not applied | Run `docker compose -f base.compose.yml -f dev.compose.yml up -d` to recreate the container with the volume mount |

To confirm the mount is active inside the running container:
```bash
docker exec sink-api-1 ls -la /run/secrets/
```

To confirm cookies are being picked up (watch for the log line):
```bash
docker logs sink-api-1 2>&1 | grep "Using cookies for platform="
```
