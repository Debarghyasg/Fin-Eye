/**
 * Shared HTTP client for the Fin-Sight backend (Phase 4 frontend wiring).
 *
 * Centralised so:
 *   - Every request goes through the same auth header / error pipeline
 *   - We can detect "no backend configured" and let pages fall back to mocks
 *   - Tests can stub `apiFetch` in one place
 *
 * Auth: when the user is signed in via Clerk, every browser request carries
 *       a __session cookie that the FastAPI dependency `get_current_user`
 *       consumes. For server-rendered or SSR fetches we accept an optional
 *       `getToken()` that returns a bearer token (Clerk's `auth().getToken()`).
 */
const RAW_API_URL = process.env.NEXT_PUBLIC_API_URL;

/**
 * `IS_LIVE_API` is true when NEXT_PUBLIC_API_URL is set in frontend/.env.local.
 *
 * When false, every page falls back to in-memory mock data — nothing
 * touches the real database. If the app looks wrong or uploads don't persist,
 * this is almost always the cause.
 *
 * Fix: copy frontend/.env.local.example to frontend/.env.local and fill in
 * your Clerk keys. The file must contain:
 *   NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1
 */
export const IS_LIVE_API: boolean = Boolean(RAW_API_URL && RAW_API_URL.length > 0);

export const API_BASE: string = RAW_API_URL ?? "http://localhost:8000/api/v1";

// Warn loudly in the browser console when running in mock mode so the
// developer knows immediately why nothing is hitting the database.
if (typeof window !== "undefined" && !IS_LIVE_API) {
  console.warn(
    "[Fin-Eye] NEXT_PUBLIC_API_URL is not set.\n" +
    "The app is running in MOCK MODE — no data goes to the real database.\n" +
    "Fix: copy frontend/.env.local.example → frontend/.env.local and set NEXT_PUBLIC_API_URL=http://localhost:8000/api/v1\n" +
    "Then restart the frontend (npm run dev)."
  );
}

export class ApiError extends Error {
  status: number;
  detail: unknown;
  constructor(status: number, detail: unknown, message?: string) {
    super(message ?? `API ${status}`);
    this.status = status;
    this.detail = detail;
    this.name = "ApiError";
  }
}

export type GetTokenFn = () => Promise<string | null | undefined>;

interface ApiFetchInit extends Omit<RequestInit, "body"> {
  /** JSON-serialisable request body (will be stringified). */
  json?: unknown;
  /** Raw body (for FormData, multipart uploads). Mutually exclusive with `json`. */
  body?: BodyInit;
  /** Optional Clerk token getter for SSR / server actions. */
  getToken?: GetTokenFn;
  /** When true, returns the raw Response so callers can stream / read blobs. */
  raw?: boolean;
  /** Additional URLSearchParams to append. */
  query?: Record<string, string | number | boolean | undefined | null>;
}

function buildUrl(path: string, query?: ApiFetchInit["query"]): string {
  const url = new URL(`${API_BASE.replace(/\/$/, "")}/${path.replace(/^\//, "")}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

/**
 * Fire an HTTP request to the Fin-Sight backend.
 *
 * Throws ApiError with the parsed `detail` payload on non-2xx responses
 * so caller `catch` blocks can show a clean message.
 */
export async function apiFetch<T = unknown>(
  path: string,
  init: ApiFetchInit = {}
): Promise<T> {
  const { json, body, getToken, raw, query, headers, ...rest } = init;
  const finalHeaders = new Headers(headers);

  if (json !== undefined) {
    finalHeaders.set("Content-Type", "application/json");
  }
  if (!finalHeaders.has("Accept")) {
    finalHeaders.set("Accept", "application/json");
  }

  if (getToken) {
    const token = await getToken();
    if (token) finalHeaders.set("Authorization", `Bearer ${token}`);
  }

  const url = buildUrl(path, query);

  const response = await fetch(url, {
    credentials: "include", // include Clerk's __session cookie for browser-side calls
    ...rest,
    headers: finalHeaders,
    body: json !== undefined ? JSON.stringify(json) : body,
  });

  if (!response.ok) {
    let detail: unknown = response.statusText;
    try {
      const ct = response.headers.get("content-type") ?? "";
      detail = ct.includes("application/json")
        ? await response.json()
        : await response.text();
    } catch {
      // ignore — keep statusText as detail
    }
    const message =
      typeof detail === "object" && detail !== null && "detail" in detail
        ? String((detail as { detail: unknown }).detail)
        : typeof detail === "string"
          ? detail
          : `Request failed (${response.status})`;
    throw new ApiError(response.status, detail, message);
  }

  if (raw) return response as unknown as T;

  if (response.status === 204) return undefined as unknown as T;

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return (await response.json()) as T;
  }
  return (await response.text()) as unknown as T;
}
