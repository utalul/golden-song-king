import { assertAudioProvider } from "./audioProvider.js";
import { mockAudioProvider } from "./mockAudioProvider.js";

const providers = new Map([
  [mockAudioProvider.name, mockAudioProvider]
]);

export function getProvider(name) {
  const provider = providers.get(name);

  if (!provider) {
    throw new Error(`找不到 Audio provider：${name}`);
  }

  return assertAudioProvider(provider);
}

export function listProviders() {
  return [...providers.keys()];
}
