/**
 * Connectable TUI providers, credential-ref mapping, and model-catalog
 * helpers. Route baseURLs here must match the `llm-pi-ai` overlay in
 * `cordis.patch.yml`; the official DeepSeek adapter is connect-only.
 * @module @deepseek-ai/dsh-tui/connect
 */

/** OpenAI-compatible chat/completions models on OpenCode Go. */
export const OPENCODE_GO_CHAT_MODELS = [
  'glm-5.3',
  'glm-5.2',
  'glm-5.1',
  'kimi-k3',
  'kimi-k2.7-code',
  'kimi-k2.6',
  'deepseek-v4-pro',
  'deepseek-v4-flash',
  'mimo-v2.5',
  'mimo-v2.5-pro',
  'hy3',
] as const

/** Cline Pass chat/completions model slugs (full id as the gateway serves them). */
export const CLINE_PASS_CHAT_MODELS = [
  'cline-pass/glm-5.2',
  'cline-pass/kimi-k3',
  'cline-pass/kimi-k2.7-code',
  'cline-pass/kimi-k2.6',
  'cline-pass/deepseek-v4-pro',
  'cline-pass/deepseek-v4-flash',
  'cline-pass/mimo-v2.5',
  'cline-pass/mimo-v2.5-pro',
  'cline-pass/minimax-m3',
  'cline-pass/qwen3.8-max',
  'cline-pass/qwen3.7-max',
  'cline-pass/qwen3.7-plus',
] as const

/** Hand-declared openai-completions route facts for a TUI-mounted gateway. */
export interface GatewayRoute {
  /** pi-ai wire protocol. */
  readonly api: 'openai-completions'
  /** Chat-completions prefix (no trailing `/chat/completions`). */
  readonly baseURL: string
  /** Model ids this route lists. */
  readonly models: readonly string[]
}

/** One provider the `/connect` dialog can store a key for. */
export interface ConnectProvider {
  /** Harness provider route (`GenerateOptions.provider`). */
  readonly id: string
  /** Name shown in `/connect` and the model picker. */
  readonly displayName: string
  /** Writable credential reference the route and `credentials.set` use. */
  readonly apiKeyEnv: string
  /** Extra refs that count as configured; never written. */
  readonly apiKeyEnvAliases?: readonly string[]
  /** Where the user obtains a key. */
  readonly subscribeUrl?: string
  /** pi-ai overlay route; omitted for official DeepSeek. */
  readonly route?: GatewayRoute
}

/**
 * Providers `/connect` can configure. OpenCode Go and Cline Pass are also
 * declared on the TUI `llm-pi-ai` overlay so selecting one of their models
 * hits that route's endpoint.
 */
export const CONNECT_PROVIDERS: readonly ConnectProvider[] = [
  {
    id: 'opencode-go',
    displayName: 'OpenCode Go',
    apiKeyEnv: 'OPENCODE_API_KEY',
    apiKeyEnvAliases: ['OPENCODE_GO_API_KEY'],
    subscribeUrl: 'https://opencode.ai/auth',
    route: {
      api: 'openai-completions',
      baseURL: 'https://opencode.ai/zen/go/v1',
      models: OPENCODE_GO_CHAT_MODELS,
    },
  },
  {
    id: 'cline-pass',
    displayName: 'Cline Pass',
    apiKeyEnv: 'CLINE_API_KEY',
    subscribeUrl: 'https://app.cline.bot',
    route: {
      api: 'openai-completions',
      baseURL: 'https://api.cline.bot/api/v1',
      models: CLINE_PASS_CHAT_MODELS,
    },
  },
  {
    id: 'deepseek-official',
    displayName: 'DeepSeek',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
  },
]

/** Configured/writable facts for one `/connect` row. */
export interface ConnectProviderRow {
  readonly id: string
  readonly displayName: string
  readonly apiKeyEnv: string
  readonly configured: boolean
  readonly writable: boolean
}

/** One model-picker row: provider route plus model identity. */
export interface CatalogModelRow {
  readonly provider: string
  readonly id: string
  readonly name: string
}

/**
 * Look up a connectable provider by route id.
 * @param id - harness provider route.
 * @returns the catalog entry, or undefined when `/connect` does not offer it.
 */
export function connectProviderById(id: string): ConnectProvider | undefined {
  return CONNECT_PROVIDERS.find(provider => provider.id === id)
}

/**
 * Credential refs that count as "this provider has a key".
 * @param provider - connectable provider.
 * @returns the writable ref first, then aliases.
 */
export function credentialRefsFor(provider: ConnectProvider): readonly string[] {
  return provider.apiKeyEnvAliases === undefined
    ? [provider.apiKeyEnv]
    : [provider.apiKeyEnv, ...provider.apiKeyEnvAliases]
}

/**
 * The one ref `/connect` writes through `ctx.credentials.set`.
 * @param provider - connectable provider.
 * @returns the writable environment-variable name.
 */
export function writableCredentialRef(provider: ConnectProvider): string {
  return provider.apiKeyEnv
}

/**
 * Chat-completions base URL for a hand-declared gateway route.
 * @param providerId - harness provider route.
 * @returns the overlay baseURL, or undefined for official DeepSeek.
 */
export function routeBaseURL(providerId: string): string | undefined {
  return connectProviderById(providerId)?.route?.baseURL
}

/**
 * Display name for a provider route in the model picker.
 * @param providerId - harness provider route.
 * @returns the catalog display name, or the raw id.
 */
export function providerDisplayName(providerId: string): string {
  return connectProviderById(providerId)?.displayName ?? providerId
}

/**
 * Sort model rows by provider id, then model name.
 * @param models - picker rows.
 * @returns a new sorted array.
 */
export function sortModelRows(models: readonly CatalogModelRow[]): CatalogModelRow[] {
  return [...models].sort((left, right) => {
    const provider = left.provider.localeCompare(right.provider)
    return provider !== 0 ? provider : left.name.localeCompare(right.name)
  })
}

/**
 * Format model-picker lines grouped by provider display name.
 * @param models - sorted picker rows.
 * @returns `OpenCode Go / glm-5.3` lines.
 */
export function formatModelPickerLines(models: readonly CatalogModelRow[]): readonly string[] {
  return models.map(model => `${providerDisplayName(model.provider)} / ${model.name}`)
}

/**
 * Format a `/connect` provider row, marking configured keys without values.
 * @param row - configured/writable facts.
 * @returns a one-line label.
 */
export function formatConnectProviderLine(row: ConnectProviderRow): string {
  const badge = row.configured ? (row.writable ? 'configured' : 'env (read-only)') : 'not configured'
  return `${row.displayName}  ${badge}`
}

/**
 * Mask a secret for the connect dialog. The result contains no secret bytes.
 * @param value - the typed key; never logged.
 * @returns one bullet per character.
 */
export function maskSecret(value: string): string {
  return '•'.repeat(value.length)
}

/**
 * First-run guidance when no connectable provider has a key.
 */
export const MISSING_KEY_GUIDANCE
  = 'No provider API key is configured. Use /connect to paste an OpenCode Go, Cline Pass, or DeepSeek key.'
