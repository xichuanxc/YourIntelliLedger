/**
 * How `parse_receipt` reaches a model — spec §5.1, §13.
 *
 * An interface rather than a direct call, because two implementations are
 * planned and the second is the real one:
 *
 *   byokTransport   Week 6, development — the user's own key, direct to the
 *                   provider. §8.2 defines BYOK as a first-class mode the app
 *                   falls back to whenever attestation is unavailable, which
 *                   is exactly our situation until Week 7.
 *   hubTransport    Week 7 — POST /v1/chat against the §13.2 contract, where
 *                   the gateway key lives and usage is metered.
 *
 * Nothing above this interface knows which is in use, so Week 7 swaps the
 * implementation without touching the parse orchestration or the review screen.
 *
 * **No key ever enters the binary** (§8.2). A BYOK key is typed by the user at
 * runtime and held in `expo-secure-store` — Keystore on Android, Keychain on
 * iOS.
 */

export interface ParseRequest {
  /** The system prompt — §13.7 forwards it byte-for-byte, so the app owns it. */
  prompt: string;
  /** Reconstructed receipt text from §5.4. */
  ocrText: string;
  /**
   * Validator errors from a rejected first attempt. §5.5 allows exactly one
   * retry, and the model needs to be told what was wrong to have any chance
   * of fixing it.
   */
  priorErrors?: string[];
}

export interface ParseResponse {
  /** The raw reply. Parsing and validation happen above the transport. */
  text: string;
  /** Which model answered, recorded on the bill as `model_alias` (§4.4). */
  modelAlias: string;
  usage?: { promptTokens?: number; completionTokens?: number };
}

export interface ParseTransport {
  readonly name: string;
  parseReceipt(request: ParseRequest): Promise<ParseResponse>;
}

/** No key configured, or the provider rejected it. */
export class TransportUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransportUnavailableError';
  }
}

/** The provider was reachable but did not answer usefully. */
export class TransportRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number
  ) {
    super(message);
    this.name = 'TransportRequestError';
  }
}
