# YouTube Authentication Cookies

## Why This Exists

YouTube applies a bot-gate to certain videos — typically age-restricted content, videos
behind a login wall, or videos that YouTube's anti-bot heuristics have flagged. When
yt-dlp encounters this gate it prints "Sign in to confirm" to stderr and exits non-zero.
The API maps this to a 422 response with the message:

> This YouTube video requires authentication cookies. See docs/youtube-cookies.md for setup.

The only reliable bypass is to supply real YouTube session cookies. No `--extractor-args`
value bypasses the gate — cookies are the only solution confirmed to work.

## Step-by-Step Cookie Export

1. Install the Chrome extension **"Get cookies.txt LOCALLY"** by `kairi003`.
   Search the Chrome Web Store for the exact name. It exports cookies in the
   Netscape format that yt-dlp expects.

2. Navigate to https://www.youtube.com and confirm you are logged in to the Google
   account you want to use.

3. Click the extension icon and choose to export cookies for `youtube.com`.
   Save the file.

4. Rename the file to `youtube-cookies.txt` and place it in:
   ```
   infra/compose/secrets/youtube-cookies.txt
   ```

5. No restart is required. The API checks for the file on every request. Within
   seconds of dropping the file in, yt-dlp will start receiving the `--cookies` flag
   for YouTube URLs.

## File Format

The file must be in **Netscape HTTP Cookie File** format. The first line should be:

```
# Netscape HTTP Cookie File
```

This is what "Get cookies.txt LOCALLY" and most other cookie exporters produce by default.

## Cookie Expiry

Google session cookies expire periodically — typically every few weeks, though the
exact interval varies. If downloads start failing again with "Sign in to confirm":

1. Re-export your cookies using the same steps above.
2. Replace `infra/compose/secrets/youtube-cookies.txt` with the new file.
3. No restart required — the change takes effect immediately.

## Security Notes

- **Treat this file as a credential.** It grants access to your YouTube/Google session.
  Anyone with the file can act as you on YouTube.
- The file is git-ignored (`infra/compose/secrets/.gitignore` excludes all files except
  `.gitignore` and `README.md`). Never commit it.
- Inside the container the directory is mounted read-only at `/run/secrets/`.
- The application logs only the URL hostname when cookies are used — the cookies path
  and file contents are never written to logs.

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| Still getting 422 "requires authentication cookies" | Cookies not found at expected path | Verify file is named `youtube-cookies.txt` in `infra/compose/secrets/` |
| Still getting 422 after adding cookies | Cookies have expired | Re-export from browser |
| Still getting 422 after re-export | Wrong Google account | Log into the correct account before exporting |
| API container can't read the file | Mount not applied | Run `docker compose -f base.compose.yml -f dev.compose.yml up -d` to recreate the container with the volume mount |

To confirm the mount is active inside the running container:
```bash
docker exec sink-api-1 ls -la /run/secrets/
```

To confirm cookies are being picked up (watch for the log line):
```bash
docker logs sink-api-1 2>&1 | grep "Using YouTube cookies"
```
