/** Shared capture error type — used by desktop fulfillment and floor/mobile capture. */
export class MesCaptureError extends Error {
  code?: string;
  details?: Record<string, unknown>;

  constructor(message: string, code?: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'MesCaptureError';
    this.code = code;
    this.details = details;
  }
}
