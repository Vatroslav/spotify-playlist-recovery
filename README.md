# Spotify Playlist Recovery

Scans your Spotify playlists for unavailable/disabled tracks and finds playable replacements by the same artist.

## Setup

### 1. Spotify Developer App

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create an app → select "Web API"
3. Add your deploy URL as Redirect URI (e.g. `https://your-app.vercel.app`)
4. Copy the **Client ID**

### 2. Deploy to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → Import the repo
3. In **Environment Variables**, add:
   - `VITE_SPOTIFY_CLIENT_ID` = your Client ID from step 1
4. Deploy

### 3. Update Spotify Redirect URI

After deploy, copy your Vercel URL (e.g. `https://spotify-playlist-recovery.vercel.app`) and add it as a Redirect URI in your Spotify app settings.

## How it works

1. OAuth login via PKCE (no backend needed)
2. Lists your playlists
3. Scans selected playlist for tracks where `is_playable: false`
4. Searches Spotify for same artist + same track name that IS playable
5. Shows matches, lets you select preferred versions
6. Creates a new private "Recovered" playlist with selected replacements

## Limitations

- Only works for playlists you own or collaborate on (Spotify API restriction)
- Search returns max 10 results per query (Feb 2026 API change)
- `linked_from` field removed from API — relies on search matching
- Matching is normalized (ignores brackets, punctuation) — may miss remasters/remixes with different naming
