/* global process */

import { ProviderUnavailableError } from "./providerUnavailableError.js";

const TRACKS_URL = "https://api.jamendo.com/v3.0/tracks/";
const REQUIRED_ENVIRONMENT_VARIABLES = ["JAMENDO_CLIENT_ID"];

function requiredClientId() {
  const clientId = process.env.JAMENDO_CLIENT_ID;

  if (!clientId) {
    throw new ProviderUnavailableError(
      "Jamendo",
      REQUIRED_ENVIRONMENT_VARIABLES
    );
  }

  return clientId;
}

export const jamendoProbeProvider = {
  name: "jamendo-experimental",
  requiredEnvironmentVariables: REQUIRED_ENVIRONMENT_VARIABLES,

  isAvailable() {
    return REQUIRED_ENVIRONMENT_VARIABLES.every(
      (name) => Boolean(process.env[name])
    );
  },

  async searchTrack({ songName, artist }) {
    const url = new URL(TRACKS_URL);

    url.searchParams.set("client_id", requiredClientId());
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1");
    url.searchParams.set("order", "relevance");
    url.searchParams.set("audioformat", "mp31");
    url.searchParams.set("include", "licenses");
    url.searchParams.set("search", `${songName} ${artist}`);

    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(`Jamendo search HTTP ${response.status}`);
    }

    const payload = await response.json();
    const track = payload?.results?.[0];

    if (!track?.id || !track?.name || !track?.artist_name) {
      return null;
    }

    return {
      provider: "jamendo-experimental",
      providerTrackId: String(track.id),
      matchedSongName: track.name,
      matchedArtist: track.artist_name,
      previewUrl: track.audio || null,
      duration:
        Number.isFinite(Number(track.duration))
          ? Number(track.duration)
          : null,
      metadata: {
        licenseUrl: track.license_ccurl || null,
        shareUrl: track.shareurl || null,
        streamType: "FULL_TRACK_STREAM"
      }
    };
  }
};
