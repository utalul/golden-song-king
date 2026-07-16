const TOKEN_URL = "https://accounts.spotify.com/api/token";
const API_BASE_URL = "https://api.spotify.com/v1";

let cachedToken = null;
let cachedTokenExpiresAt = 0;

function getEnvValue(key) {
  const nodeEnv = globalThis.process?.env;
  const viteEnv = import.meta.env;

  return nodeEnv?.[key] ?? viteEnv?.[key] ?? "";
}

function getSpotifyCredentials() {
  const clientId = getEnvValue("SPOTIFY_CLIENT_ID");
  const clientSecret = getEnvValue("SPOTIFY_CLIENT_SECRET");

  if (!clientId || !clientSecret) {
    throw new Error("Missing Spotify API credentials");
  }

  return {
    clientId,
    clientSecret
  };
}

async function requestSpotify(path, options = {}) {
  const token = await getAccessToken();

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...options.headers
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Spotify API request failed: ${response.status} ${message}`);
  }

  return response.json();
}

export async function getAccessToken() {
  const now = Date.now();

  if (cachedToken && now < cachedTokenExpiresAt) {
    return cachedToken;
  }

  const { clientId, clientSecret } = getSpotifyCredentials();
  const authorization = globalThis.btoa(`${clientId}:${clientSecret}`);

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${authorization}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials"
    })
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Spotify token request failed: ${response.status} ${message}`);
  }

  const data = await response.json();

  cachedToken = data.access_token;
  cachedTokenExpiresAt = now + (data.expires_in - 60) * 1000;

  return cachedToken;
}

export async function searchTrack(songName, artist) {
  const params = new URLSearchParams({
    q: `track:${songName} artist:${artist}`,
    type: "track",
    limit: "1"
  });

  const data = await requestSpotify(`/search?${params.toString()}`);

  return data.tracks?.items?.[0] ?? null;
}

export async function getTrack(id) {
  return requestSpotify(`/tracks/${encodeURIComponent(id)}`);
}

export function sleep(ms) {
  return new Promise((resolve) => {
    globalThis.setTimeout(resolve, ms);
  });
}
