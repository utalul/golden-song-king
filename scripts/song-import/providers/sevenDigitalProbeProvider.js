/* global process */

import crypto from "crypto";

import { ProviderUnavailableError } from "./providerUnavailableError.js";

const API_BASE_URL = "https://api.7digital.com/1.2";
const PREVIEW_BASE_URL = "https://previews.7digital.com";
const REQUIRED_ENVIRONMENT_VARIABLES = [
  "SEVENDIGITAL_API_KEY",
  "SEVENDIGITAL_API_SECRET"
];

function percentEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/[!'()*]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    );
}

function signPreviewUrl(trackId, country, key, secret) {
  const baseUrl = `${PREVIEW_BASE_URL}/clip/${trackId}`;
  const parameters = {
    country,
    oauth_consumer_key: key,
    oauth_nonce: crypto.randomBytes(12).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000),
    oauth_version: "1.0"
  };
  const parameterString = Object.entries(parameters)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([name, value]) =>
        `${percentEncode(name)}=${percentEncode(value)}`
    )
    .join("&");
  const signatureBase = [
    "GET",
    percentEncode(baseUrl),
    percentEncode(parameterString)
  ].join("&");
  const signature = crypto
    .createHmac("sha1", `${percentEncode(secret)}&`)
    .update(signatureBase)
    .digest("base64");
  const url = new URL(baseUrl);

  Object.entries({ ...parameters, oauth_signature: signature })
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([name, value]) => url.searchParams.set(name, value));

  return url.toString();
}

function firstTrack(payload) {
  const results = payload?.searchResults?.searchResult;
  const firstResult = Array.isArray(results) ? results[0] : results;

  return firstResult?.track || null;
}

function requiredCredentials() {
  const key = process.env.SEVENDIGITAL_API_KEY;
  const secret = process.env.SEVENDIGITAL_API_SECRET;

  if (!key || !secret) {
    throw new ProviderUnavailableError(
      "7digital",
      REQUIRED_ENVIRONMENT_VARIABLES
    );
  }

  return { key, secret };
}

export const sevenDigitalProbeProvider = {
  name: "7digital-experimental",
  requiredEnvironmentVariables: REQUIRED_ENVIRONMENT_VARIABLES,

  isAvailable() {
    return REQUIRED_ENVIRONMENT_VARIABLES.every(
      (name) => Boolean(process.env[name])
    );
  },

  async searchTrack({ songName, artist }) {
    const { key, secret } = requiredCredentials();
    const country = process.env.SEVENDIGITAL_COUNTRY || "TW";
    const url = new URL(`${API_BASE_URL}/track/search`);

    url.searchParams.set("q", `${songName} ${artist}`);
    url.searchParams.set("country", country);
    url.searchParams.set("format", "json");
    url.searchParams.set("oauth_consumer_key", key);

    const response = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10000)
    });

    if (!response.ok) {
      throw new Error(`7digital search HTTP ${response.status}`);
    }

    const track = firstTrack(await response.json());

    if (!track?.id || !track?.title || !track?.artist?.name) {
      return null;
    }

    return {
      provider: "7digital-experimental",
      providerTrackId: String(track.id),
      matchedSongName: track.title,
      matchedArtist: track.artist.name,
      previewUrl: signPreviewUrl(track.id, country, key, secret),
      duration:
        Number.isFinite(Number(track.duration))
          ? Number(track.duration)
          : null,
      metadata: {
        releaseName: track.release?.title || null,
        previewUrlPersistence: "SIGNED_TEMPORARY",
        previewProbeMethod: "GET_RANGE_0_0"
      }
    };
  }
};
