export class ProviderUnavailableError extends Error {
  constructor(provider, requiredEnvironmentVariables) {
    super(`${provider} provider 缺少必要的環境變數。`);
    this.name = "ProviderUnavailableError";
    this.code = "PROVIDER_UNAVAILABLE";
    this.requiredEnvironmentVariables = requiredEnvironmentVariables;
  }
}
