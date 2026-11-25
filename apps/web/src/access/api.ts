import { redirect } from "react-router";

const messages: Record<string, string> = {
  INVALID_LOGIN: "The email or password is incorrect.",
  INVALID_RESET: "This code is invalid or expired. Ask your administrator for a new code.",
  INVALID_INPUT: "Check the email, password length and selected roles.",
  EMAIL_IN_USE: "That email already has an account.",
  SELF_ADMINISTRATION: "Another administrator must change your access.",
  STALE_STAFF: "This account changed. Review its current settings and try again.",
  STAFF_DISABLED: "Enable the account before issuing a reset code.",
  STAFF_NOT_FOUND: "This account is no longer available.",
  CSRF_FAILED: "Refresh the page before trying again.",
  ORIGIN_DENIED: "Open the application at its configured address and try again.",
  FORBIDDEN: "Your account does not have permission for this action.",
  TRY_LATER: "Too many attempts. Please try again in 15 minutes.",
};

export class RequestError extends Error {
  constructor(public readonly status: number, code: string) {
    super(messages[code] ?? "Could not complete the request. Please try again.");
  }
}

export async function api(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch("/api/v1" + path, { credentials: "same-origin", cache: "no-store", ...init });
  if (response.status === 204) return null;
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && path !== "/auth/login") throw redirect("/login");
    throw new RequestError(response.status, body?.code ?? "");
  }
  return body;
}

export function send(path: string, data: unknown, csrf?: string, method = "POST") {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (csrf) headers["X-CSRF-Token"] = csrf;
  return api(path, { method, headers, body: JSON.stringify(data) });
}

export function actionError(error: unknown) {
  if (error instanceof Response) throw error;
  return { error: error instanceof RequestError ? error.message : "The service could not be reached. Please try again." };
}
