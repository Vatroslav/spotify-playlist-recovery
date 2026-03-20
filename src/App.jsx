import { useState, useEffect, useRef } from "react";

// ============================================================
// CONFIG
// ============================================================
const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID || "YOUR_CLIENT_ID_HERE";
const REDIRECT_URI = window.location.origin;
const SCOPES = [
  "playlist-read-private",
  "playlist-read-collaborative",
  "playlist-modify-public",
  "playlist-modify-private",
].join(" ");

// ============================================================
// PKCE helpers
// ============================================================
function generateRandomString(length) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]).join("");
}

async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// ============================================================
// Spotify API wrapper
// ============================================================
class SpotifyAPI {
  constructor(token) {
    this.token = token;
    this.baseUrl = "https://api.spotify.com/v1";
  }

  async fetch(endpoint, options = {}) {
    const url = endpoint.startsWith("http") ? endpoint : `${this.baseUrl}${endpoint}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
    if (res.status === 429) {
      const retry = parseInt(res.headers.get("Retry-After") || "2", 10);
      await new Promise((r) => setTimeout(r, retry * 1000));
      return this.fetch(endpoint, options);
    }
    if (!res.ok) throw new Error(`Spotify API ${res.status}: ${res.statusText}`);
    if (res.status === 204) return null;
    return res.json();
  }

  async getMyPlaylists() {
    const all = [];
    let url = "/me/playlists?limit=50";
    while (url) {
      const data = await this.fetch(url);
      all.push(...(data.items || []).filter(Boolean));
      url = data.next || null;
    }
    return all;
  }

  async getPlaylistTracks(playlistId, market = "HR") {
    const all = [];
    let url = `/playlists/${playlistId}/items?limit=50&market=${market}`;
    while (url) {
      const data = await this.fetch(url);
      all.push(...(data.items || []));
      url = data.next || null;
    }
    return all;
  }

  async searchTrack(artist, trackName, market = "HR") {
    const q = encodeURIComponent(`artist:${artist} track:${trackName}`);
    const data = await this.fetch(`/search?q=${q}&type=track&market=${market}&limit=10`);
    return data?.tracks?.items || [];
  }

  async createPlaylist(name, description) {
    return this.fetch(`/me/playlists`, {
      method: "POST",
      body: JSON.stringify({ name, description, public: false }),
    });
  }

  async addTracksToPlaylist(playlistId, uris) {
    for (let i = 0; i < uris.length; i += 100) {
      await this.fetch(`/playlists/${playlistId}/items`, {
        method: "POST",
        body: JSON.stringify({ uris: uris.slice(i, i + 100) }),
      });
    }
  }

  async getMe() {
    return this.fetch("/me");
  }
}

// ============================================================
// Normalize for matching
// ============================================================
function normalize(str) {
  return str
    .toLowerCase()
    .replace(/\(.*?\)/g, "")
    .replace(/\[.*?\]/g, "")
    .replace(/[-–—]/g, " ")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isSameTrack(a, b) {
  return normalize(a) === normalize(b);
}

function normalizeArtist(str) {
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
}

// ============================================================
// Status enum
// ============================================================
const STATUS = {
  IDLE: "idle",
  LOADING_PLAYLISTS: "loading_playlists",
  SCANNING: "scanning",
  SEARCHING: "searching",
  DONE: "done",
  CREATING_PLAYLIST: "creating_playlist",
};

// ============================================================
// Main App
// ============================================================
export default function App() {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [playlists, setPlaylists] = useState([]);
  const [selectedPlaylist, setSelectedPlaylist] = useState(null);
  const [disabledTracks, setDisabledTracks] = useState([]);
  const [replacements, setReplacements] = useState({});
  const [status, setStatus] = useState(STATUS.IDLE);
  const [progress, setProgress] = useState({ current: 0, total: 0, trackName: "" });
  const [error, setError] = useState(null);
  const [selectedReplacements, setSelectedReplacements] = useState({});
  const [recoveryResult, setRecoveryResult] = useState(null);
  const [searchFilter, setSearchFilter] = useState("");
  const [market, setMarket] = useState("HR");
  const apiRef = useRef(null);
  const abortRef = useRef(false);

  // --- Auth ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (code) {
      const verifier = sessionStorage.getItem("pkce_verifier");
      if (verifier) {
        exchangeToken(code, verifier);
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    } else {
      const stored = sessionStorage.getItem("spotify_token");
      const exp = sessionStorage.getItem("spotify_token_exp");
      if (stored && exp && Date.now() < parseInt(exp)) {
        setToken(stored);
      }
    }
  }, []);

  useEffect(() => {
    if (token) {
      apiRef.current = new SpotifyAPI(token);
      apiRef.current.getMe().then(setUser).catch(() => {
        sessionStorage.removeItem("spotify_token");
        setToken(null);
      });
    }
  }, [token]);

  async function exchangeToken(code, verifier) {
    try {
      const res = await fetch("https://accounts.spotify.com/api/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: REDIRECT_URI,
          client_id: CLIENT_ID,
          code_verifier: verifier,
        }),
      });
      const data = await res.json();
      if (data.access_token) {
        sessionStorage.setItem("spotify_token", data.access_token);
        sessionStorage.setItem("spotify_token_exp", String(Date.now() + data.expires_in * 1000));
        setToken(data.access_token);
      } else {
        setError("Auth failed: " + (data.error_description || data.error || "Unknown error"));
      }
    } catch (e) {
      setError("Token exchange failed: " + e.message);
    }
  }

  async function login() {
    if (CLIENT_ID === "YOUR_CLIENT_ID_HERE") {
      setError("Set VITE_SPOTIFY_CLIENT_ID in your .env file first.");
      return;
    }
    const verifier = generateRandomString(128);
    const challenge = await generateCodeChallenge(verifier);
    sessionStorage.setItem("pkce_verifier", verifier);
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      response_type: "code",
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      code_challenge_method: "S256",
      code_challenge: challenge,
    });
    window.location.href = `https://accounts.spotify.com/authorize?${params}`;
  }

  function logout() {
    sessionStorage.removeItem("spotify_token");
    sessionStorage.removeItem("spotify_token_exp");
    setToken(null);
    setUser(null);
    setPlaylists([]);
    setSelectedPlaylist(null);
    setDisabledTracks([]);
    setReplacements({});
    setStatus(STATUS.IDLE);
  }

  async function loadPlaylists() {
    setStatus(STATUS.LOADING_PLAYLISTS);
    setError(null);
    try {
      const pls = await apiRef.current.getMyPlaylists();
      setPlaylists(pls.filter((p) => p && p.id));
      setStatus(STATUS.IDLE);
    } catch (e) {
      setError("Failed to load playlists: " + e.message);
      setStatus(STATUS.IDLE);
    }
  }

  async function scanPlaylist(playlist) {
    setSelectedPlaylist(playlist);
    setDisabledTracks([]);
    setReplacements({});
    setSelectedReplacements({});
    setRecoveryResult(null);
    setStatus(STATUS.SCANNING);
    setError(null);
    abortRef.current = false;

    try {
      const items = await apiRef.current.getPlaylistTracks(playlist.id, market);
      const disabled = items.filter((item) => {
        if (!item.track || item.is_local) return false;
        const t = item.track;
        return t.is_playable === false || (t.restrictions && t.restrictions.reason === "market");
      });

      setDisabledTracks(disabled);
      if (disabled.length === 0) {
        setStatus(STATUS.DONE);
        return;
      }

      setStatus(STATUS.SEARCHING);
      const reps = {};

      for (let i = 0; i < disabled.length; i++) {
        if (abortRef.current) break;
        const track = disabled[i].track;
        const artistName = track.artists?.[0]?.name || "";
        const trackName = track.name || "";
        setProgress({ current: i + 1, total: disabled.length, trackName });

        try {
          const results = await apiRef.current.searchTrack(artistName, trackName, market);
          const matches = results.filter((r) => {
            if (!r.is_playable) return false;
            if (r.id === track.id) return false;
            const artistMatch = r.artists?.some((a) => normalizeArtist(a.name) === normalizeArtist(artistName));
            const nameMatch = isSameTrack(r.name, trackName);
            return artistMatch && nameMatch;
          });

          if (matches.length > 0) {
            reps[track.id] = matches;
            setSelectedReplacements((prev) => ({ ...prev, [track.id]: matches[0].uri }));
          }
        } catch (e) {
          console.warn(`Search failed for "${trackName}":`, e.message);
        }

        if (i < disabled.length - 1) await new Promise((r) => setTimeout(r, 150));
      }

      setReplacements(reps);
      setStatus(STATUS.DONE);
    } catch (e) {
      setError("Scan failed: " + e.message);
      setStatus(STATUS.IDLE);
    }
  }

  async function createRecoveryPlaylist() {
    setStatus(STATUS.CREATING_PLAYLIST);
    setError(null);
    try {
      const uris = Object.values(selectedReplacements).filter(Boolean);
      if (uris.length === 0) {
        setError("No replacements selected.");
        setStatus(STATUS.DONE);
        return;
      }
      const name = `${selectedPlaylist.name} — Recovered`;
      const desc = `Recovered ${uris.length} previously unavailable tracks from "${selectedPlaylist.name}"`;
      const newPl = await apiRef.current.createPlaylist(name, desc);
      await apiRef.current.addTracksToPlaylist(newPl.id, uris);
      setRecoveryResult({ name: newPl.name, url: newPl.external_urls?.spotify, count: uris.length });
      setStatus(STATUS.DONE);
    } catch (e) {
      setError("Failed to create playlist: " + e.message);
      setStatus(STATUS.DONE);
    }
  }

  const filteredPlaylists = playlists.filter((p) =>
    p.name?.toLowerCase().includes(searchFilter.toLowerCase())
  );
  const foundCount = Object.keys(replacements).length;
  const notFoundCount = disabledTracks.length - foundCount;

  // ============================================================
  // RENDER
  // ============================================================
  return (
    <div style={s.container}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <div style={s.logoMark}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M3 14L10 3L17 14" stroke="#1DB954" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M6 9.5H14" stroke="#1DB954" strokeWidth="2" strokeLinecap="round"/>
              <circle cx="10" cy="17" r="1.5" fill="#1DB954"/>
            </svg>
          </div>
          <div>
            <h1 style={s.title}>Playlist Recovery</h1>
            <p style={s.subtitle}>Find & replace unavailable tracks</p>
          </div>
        </div>
        {user && (
          <div style={s.headerRight}>
            <span style={s.userName}>{user.display_name}</span>
            <select value={market} onChange={(e) => setMarket(e.target.value)} style={s.marketSelect}>
              <option value="HR">HR</option>
              <option value="US">US</option>
              <option value="GB">GB</option>
              <option value="DE">DE</option>
              <option value="AT">AT</option>
              <option value="SI">SI</option>
              <option value="RS">RS</option>
            </select>
            <button onClick={logout} style={s.logoutBtn}>Sign out</button>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div style={s.error}>
          <span style={s.errLabel}>ERR</span>
          <span style={{ flex: 1 }}>{error}</span>
          <button onClick={() => setError(null)} style={s.dismissBtn}>✕</button>
        </div>
      )}

      {/* Login */}
      {!token && (
        <div style={s.loginWrap}>
          <div style={s.loginCard}>
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none" style={{ marginBottom: 24 }}>
              <circle cx="24" cy="24" r="22" stroke="rgba(29,185,84,0.3)" strokeWidth="1"/>
              <path d="M15 30C15 30 18 26 24 26C30 26 33 30 33 30" stroke="#1DB954" strokeWidth="2.5" strokeLinecap="round"/>
              <path d="M12 25C12 25 16 20 24 20C32 20 36 25 36 25" stroke="rgba(29,185,84,0.5)" strokeWidth="2" strokeLinecap="round"/>
              <path d="M9 20C9 20 14 14 24 14C34 14 39 20 39 20" stroke="rgba(29,185,84,0.3)" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            <p style={s.loginText}>Connect your Spotify account to scan playlists for unavailable tracks and find playable replacements.</p>
            <button onClick={login} style={s.loginBtn}>Connect to Spotify</button>
          </div>
        </div>
      )}

      {/* Main */}
      {token && (
        <div style={s.main}>
          {/* Load playlists */}
          {playlists.length === 0 && status !== STATUS.LOADING_PLAYLISTS && (
            <div style={s.center}>
              <button onClick={loadPlaylists} style={s.primaryBtn}>Load My Playlists</button>
            </div>
          )}

          {status === STATUS.LOADING_PLAYLISTS && (
            <div style={s.center}>
              <div style={s.spinner} />
              <p style={s.dimText}>Loading playlists...</p>
            </div>
          )}

          {/* Playlist list */}
          {playlists.length > 0 && !selectedPlaylist && (
            <div>
              <div style={s.row}>
                <span style={s.sectionTitle}>Your Playlists</span>
                <span style={s.badge}>{playlists.length}</span>
              </div>
              <input
                type="text"
                placeholder="Filter playlists..."
                value={searchFilter}
                onChange={(e) => setSearchFilter(e.target.value)}
                style={s.filterInput}
              />
              <div style={s.playlistList}>
                {filteredPlaylists.map((pl) => (
                  <button
                    key={pl.id}
                    onClick={() => scanPlaylist(pl)}
                    style={s.plCard}
                    onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.07)"; e.currentTarget.style.borderColor = "rgba(29,185,84,0.4)"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.03)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; }}
                  >
                    {pl.images?.[0]?.url
                      ? <img src={pl.images[0].url} alt="" style={s.plImg} />
                      : <div style={s.plImgEmpty}>♫</div>
                    }
                    <div style={s.plInfo}>
                      <span style={s.plName}>{pl.name}</span>
                      <span style={s.plMeta}>{pl.tracks?.total || 0} tracks</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Scanning */}
          {selectedPlaylist && (status === STATUS.SCANNING || status === STATUS.SEARCHING) && (
            <div>
              <button onClick={() => { abortRef.current = true; setSelectedPlaylist(null); setStatus(STATUS.IDLE); }} style={s.backBtn}>← Back</button>
              <h2 style={{ ...s.sectionTitle, marginTop: 8, marginBottom: 20 }}>{selectedPlaylist.name}</h2>
              <div style={s.scanBox}>
                <div style={s.barBg}>
                  <div style={{ ...s.barFill, width: progress.total > 0 ? `${(progress.current / progress.total) * 100}%` : "0%" }} />
                </div>
                <p style={s.dimText}>
                  {status === STATUS.SCANNING ? "Scanning for unavailable tracks..." : `Searching replacements ${progress.current}/${progress.total}`}
                </p>
                {progress.trackName && <p style={s.monoSmall}>{progress.trackName}</p>}
                <button onClick={() => { abortRef.current = true; }} style={s.abortBtn}>Cancel</button>
              </div>
            </div>
          )}

          {/* Results */}
          {selectedPlaylist && status === STATUS.DONE && (
            <div>
              <button onClick={() => { setSelectedPlaylist(null); setStatus(STATUS.IDLE); }} style={s.backBtn}>← Back to playlists</button>
              <h2 style={{ ...s.sectionTitle, marginTop: 8 }}>{selectedPlaylist.name}</h2>
              <div style={s.statsRow}>
                <StatBox label="Unavailable" value={disabledTracks.length} color="#ff4444" />
                <StatBox label="Found" value={foundCount} color="#1DB954" />
                <StatBox label="No match" value={notFoundCount} color="#666" />
              </div>

              {disabledTracks.length === 0 && (
                <div style={s.allGood}><span style={{ fontSize: 32 }}>✓</span><p>All tracks are playable in {market}.</p></div>
              )}

              {foundCount > 0 && !recoveryResult && (
                <div style={{ marginBottom: 24, textAlign: "center" }}>
                  <button onClick={createRecoveryPlaylist} style={s.primaryBtn} disabled={status === STATUS.CREATING_PLAYLIST}>
                    {status === STATUS.CREATING_PLAYLIST ? "Creating..." : `Create Recovery Playlist (${Object.values(selectedReplacements).filter(Boolean).length} tracks)`}
                  </button>
                </div>
              )}

              {recoveryResult && (
                <div style={s.recoveryDone}>
                  <span style={{ color: "#1DB954", fontSize: 20 }}>✓</span>
                  <div>
                    <p style={{ color: "#fff", fontWeight: 500 }}>Created "{recoveryResult.name}" — {recoveryResult.count} tracks</p>
                    {recoveryResult.url && <a href={recoveryResult.url} target="_blank" rel="noopener noreferrer" style={s.link}>Open in Spotify →</a>}
                  </div>
                </div>
              )}

              {disabledTracks.filter((d) => replacements[d.track.id]).map((item) => (
                <TrackCard
                  key={item.track.id}
                  item={item}
                  matches={replacements[item.track.id]}
                  selected={selectedReplacements[item.track.id]}
                  onSelect={(uri) => setSelectedReplacements((p) => ({ ...p, [item.track.id]: uri }))}
                  onDeselect={() => setSelectedReplacements((p) => { const n = { ...p }; delete n[item.track.id]; return n; })}
                />
              ))}

              {disabledTracks.filter((d) => !replacements[d.track.id]).map((item) => (
                <TrackCard key={item.track.id} item={item} matches={null} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Sub-components
// ============================================================
function StatBox({ label, value, color }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 28, fontWeight: 700, fontFamily: "'JetBrains Mono', monospace", color, letterSpacing: "-0.03em" }}>{value}</span>
      <span style={{ fontSize: 11, color: "#666", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
    </div>
  );
}

function TrackCard({ item, matches, selected, onSelect, onDeselect }) {
  const track = item.track;
  const albumImg = track.album?.images?.[track.album.images.length - 1]?.url;
  const hasMatch = matches && matches.length > 0;

  return (
    <div style={s.trackCard}>
      <div style={s.trackRow}>
        {albumImg ? <img src={albumImg} alt="" style={s.trackImg} /> : <div style={s.trackImgEmpty}>?</div>}
        <div style={s.trackInfo}>
          <span style={s.trackName}>{track.name}</span>
          <span style={s.trackArtist}>{track.artists?.map((a) => a.name).join(", ")}</span>
          <span style={s.monoSmall}>{track.album?.name}</span>
        </div>
        <div style={{ ...s.tagBadge, background: hasMatch ? "rgba(29,185,84,0.15)" : "rgba(255,68,68,0.15)", color: hasMatch ? "#1DB954" : "#ff4444" }}>
          {hasMatch ? "FOUND" : "NO MATCH"}
        </div>
      </div>
      {hasMatch && (
        <div style={s.matchSection}>
          <span style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>Available versions:</span>
          {matches.map((m) => {
            const isSel = selected === m.uri;
            return (
              <button
                key={m.id}
                onClick={() => isSel ? onDeselect?.() : onSelect?.(m.uri)}
                style={{ ...s.matchBtn, borderColor: isSel ? "#1DB954" : "rgba(255,255,255,0.08)", background: isSel ? "rgba(29,185,84,0.1)" : "transparent" }}
              >
                <div style={s.radio}>{isSel && <div style={s.radioInner} />}</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 13, color: "#ddd", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.name}</span>
                  <span style={s.monoSmall}>{m.album?.name}{m.album?.release_date ? ` (${m.album.release_date.slice(0, 4)})` : ""}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Styles
// ============================================================
const s = {
  container: { minHeight: "100vh", background: "#0a0a0a", color: "#e0e0e0", fontFamily: "'Outfit', -apple-system, sans-serif" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 24px", borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.4)", backdropFilter: "blur(20px)", position: "sticky", top: 0, zIndex: 100 },
  headerLeft: { display: "flex", alignItems: "center", gap: 12 },
  headerRight: { display: "flex", alignItems: "center", gap: 12 },
  logoMark: { width: 36, height: 36, borderRadius: 8, background: "rgba(29,185,84,0.1)", display: "flex", alignItems: "center", justifyContent: "center" },
  title: { fontSize: 16, fontWeight: 600, color: "#fff", letterSpacing: "-0.02em" },
  subtitle: { fontSize: 11, color: "#666", fontFamily: "'JetBrains Mono', monospace", letterSpacing: "0.03em" },
  userName: { fontSize: 13, color: "#999" },
  marketSelect: { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "#fff", padding: "4px 8px", borderRadius: 4, fontSize: 12, fontFamily: "'JetBrains Mono', monospace", cursor: "pointer", outline: "none" },
  logoutBtn: { background: "none", border: "1px solid rgba(255,255,255,0.12)", color: "#999", padding: "5px 12px", borderRadius: 6, fontSize: 12, cursor: "pointer", fontFamily: "'Outfit', sans-serif" },

  error: { display: "flex", alignItems: "center", gap: 10, padding: "10px 20px", background: "rgba(255,68,68,0.08)", borderBottom: "1px solid rgba(255,68,68,0.2)", color: "#ff6666", fontSize: 13 },
  errLabel: { fontFamily: "'JetBrains Mono', monospace", fontSize: 11 },
  dismissBtn: { marginLeft: "auto", background: "none", border: "none", color: "#ff6666", cursor: "pointer", fontSize: 14, padding: "2px 6px" },

  loginWrap: { display: "flex", justifyContent: "center", alignItems: "center", minHeight: "80vh", padding: 24 },
  loginCard: { maxWidth: 400, textAlign: "center", padding: 40, border: "1px solid rgba(255,255,255,0.06)", borderRadius: 16, background: "rgba(255,255,255,0.02)" },
  loginText: { fontSize: 14, color: "#999", lineHeight: 1.6, marginBottom: 28 },
  loginBtn: { background: "#1DB954", color: "#000", border: "none", padding: "12px 32px", borderRadius: 24, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'Outfit', sans-serif" },

  main: { padding: 24, maxWidth: 800, margin: "0 auto" },
  center: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: 16 },
  primaryBtn: { background: "#1DB954", color: "#000", border: "none", padding: "12px 28px", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer", fontFamily: "'Outfit', sans-serif" },
  spinner: { width: 24, height: 24, border: "2px solid rgba(255,255,255,0.1)", borderTopColor: "#1DB954", borderRadius: "50%", animation: "spin 0.8s linear infinite" },
  dimText: { fontSize: 13, color: "#666" },
  monoSmall: { fontSize: 11, color: "#555", fontFamily: "'JetBrains Mono', monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },

  row: { display: "flex", alignItems: "center", gap: 10, marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: 600, color: "#fff", letterSpacing: "-0.02em" },
  badge: { fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#1DB954", background: "rgba(29,185,84,0.12)", padding: "2px 8px", borderRadius: 10 },
  filterInput: { width: "100%", padding: "10px 14px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, color: "#fff", fontSize: 13, fontFamily: "'Outfit', sans-serif", outline: "none", marginBottom: 16 },
  playlistList: { display: "flex", flexDirection: "column", gap: 2, maxHeight: "65vh", overflowY: "auto" },
  plCard: { display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, cursor: "pointer", textAlign: "left", transition: "all 0.15s", width: "100%", fontFamily: "'Outfit', sans-serif", color: "inherit" },
  plImg: { width: 44, height: 44, borderRadius: 4, objectFit: "cover", flexShrink: 0 },
  plImgEmpty: { width: 44, height: 44, borderRadius: 4, background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", color: "#444", fontSize: 18, flexShrink: 0 },
  plInfo: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0 },
  plName: { fontSize: 14, fontWeight: 500, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  plMeta: { fontSize: 12, color: "#666", fontFamily: "'JetBrains Mono', monospace" },

  backBtn: { background: "none", border: "none", color: "#666", fontSize: 13, cursor: "pointer", padding: "4px 0", fontFamily: "'Outfit', sans-serif" },
  scanBox: { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 12, padding: 24, textAlign: "center" },
  barBg: { width: "100%", height: 4, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden", marginBottom: 16 },
  barFill: { height: "100%", background: "#1DB954", borderRadius: 2, transition: "width 0.3s ease" },
  abortBtn: { background: "none", border: "1px solid rgba(255,68,68,0.3)", color: "#ff6666", padding: "6px 16px", borderRadius: 6, fontSize: 12, cursor: "pointer", fontFamily: "'Outfit', sans-serif", marginTop: 12 },

  statsRow: { display: "flex", gap: 24, margin: "16px 0 24px" },
  allGood: { display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: 48, color: "#1DB954", fontSize: 14 },

  trackCard: { background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)", borderRadius: 10, padding: 16, marginBottom: 8 },
  trackRow: { display: "flex", alignItems: "center", gap: 12 },
  trackImg: { width: 44, height: 44, borderRadius: 4, objectFit: "cover", flexShrink: 0 },
  trackImgEmpty: { width: 44, height: 44, borderRadius: 4, background: "rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "center", color: "#444", fontSize: 16, flexShrink: 0 },
  trackInfo: { display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 0 },
  trackName: { fontSize: 14, fontWeight: 500, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  trackArtist: { fontSize: 12, color: "#999", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  tagBadge: { fontSize: 10, fontWeight: 600, fontFamily: "'JetBrains Mono', monospace", padding: "4px 8px", borderRadius: 4, letterSpacing: "0.05em", flexShrink: 0 },

  matchSection: { marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,0.04)", display: "flex", flexDirection: "column", gap: 6 },
  matchBtn: { display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, cursor: "pointer", background: "transparent", textAlign: "left", transition: "all 0.15s", fontFamily: "'Outfit', sans-serif", color: "inherit", width: "100%" },
  radio: { width: 16, height: 16, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  radioInner: { width: 8, height: 8, borderRadius: "50%", background: "#1DB954" },

  recoveryDone: { display: "flex", alignItems: "center", gap: 12, padding: 20, background: "rgba(29,185,84,0.06)", border: "1px solid rgba(29,185,84,0.2)", borderRadius: 10, marginTop: 24 },
  link: { color: "#1DB954", fontSize: 13, textDecoration: "none", marginTop: 4, display: "inline-block" },
};
