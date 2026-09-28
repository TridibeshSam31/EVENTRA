/**
 * Centralized API Client for EVENTRA
 * Authoritative connection to FastAPI backend.
 */

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

export interface ApiErrorPayload {
  message: string;
  status: number;
  code?: string;
  details?: unknown;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(payload: ApiErrorPayload) {
    super(payload.message);
    this.name = "ApiError";
    this.status = payload.status;
    this.code = payload.code;
    this.details = payload.details;
  }
}

// Active operator ID (for x-user-id header role separation)
let currentOperatorId = "anonymous_operator";

export function setOperatorId(id: string) {
  currentOperatorId = id;
  if (typeof window !== "undefined") {
    localStorage.setItem("eventra_operator_id", id);
  }
}

export function getOperatorId(): string {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("eventra_operator_id");
    if (stored) return stored;
  }
  return currentOperatorId;
}

interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined | null>;
}

export async function apiRequest<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { params, headers, ...rest } = options;

  let url = `${API_BASE_URL}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;

  if (params) {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    }
    const queryString = searchParams.toString();
    if (queryString) {
      url += (url.includes("?") ? "&" : "?") + queryString;
    }
  }

  const isFormData = typeof FormData !== "undefined" && rest.body instanceof FormData;
  const reqHeaders: Record<string, string> = {
    Accept: "application/json",
    "x-user-id": getOperatorId(),
    ...(headers as Record<string, string>),
  };
  if (!isFormData && !reqHeaders["Content-Type"]) {
    reqHeaders["Content-Type"] = "application/json";
  }

  try {
    const res = await fetch(url, {
      ...rest,
      headers: reqHeaders,
    });

    if (!res.ok) {
      let errData: any = null;
      try {
        errData = await res.json();
      } catch {
        // Non-JSON response
      }

      const message =
        errData?.detail ||
        errData?.error?.message ||
        errData?.message ||
        `HTTP ${res.status}: ${res.statusText}`;

      const code = errData?.error?.code || errData?.code || undefined;

      throw new ApiError({
        message,
        status: res.status,
        code,
        details: errData,
      });
    }

    if (res.status === 204) {
      return null as T;
    }

    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof ApiError) {
      throw err;
    }
    throw new ApiError({
      message: (err as Error).message || "Network request failed",
      status: 0,
    });
  }
}

export const apiClient = {
  get: <T>(endpoint: string, options?: RequestOptions) =>
    apiRequest<T>(endpoint, { method: "GET", ...options }),

  post: <T>(endpoint: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(endpoint, {
      method: "POST",
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
      ...options,
    }),

  postForm: <T>(endpoint: string, formData: FormData, options?: RequestOptions) =>
    apiRequest<T>(endpoint, {
      method: "POST",
      body: formData,
      ...options,
    }),

  put: <T>(endpoint: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(endpoint, {
      method: "PUT",
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...options,
    }),

  patch: <T>(endpoint: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>(endpoint, {
      method: "PATCH",
      body: body !== undefined ? JSON.stringify(body) : undefined,
      ...options,
    }),

  delete: <T>(endpoint: string, options?: RequestOptions) =>
    apiRequest<T>(endpoint, { method: "DELETE", ...options }),
};
