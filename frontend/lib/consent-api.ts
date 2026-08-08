import { API_BASE, ApiError } from "@/lib/auth-api";
import { getSessionToken } from "@/lib/session";

export type ConsentType =
  | "aydinlatma_metni"
  | "acik_riza_location"
  | "terms_of_service";

export type ConsentStatusEntry = {
  published_version: string;
  body_text: string;
  granted: boolean | null;
  consent_version: string | null;
  granted_at: string | null;
};

export type ConsentStatusResponse = {
  consents: Record<string, ConsentStatusEntry>;
};

async function authJSON<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = getSessionToken();
  if (!token) {
    throw Object.assign(new Error("error_unauthorized"), {
      status: 401,
      code: "error_unauthorized",
    });
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & ApiError;
  if (!res.ok) {
    throw Object.assign(new Error(data.error ?? "request_failed"), {
      status: res.status,
      code: data.error,
    });
  }
  return data;
}

export function fetchConsentStatus() {
  return authJSON<ConsentStatusResponse>("GET", "/v1/consent/status");
}

export function grantConsent(
  consentType: ConsentType,
  consentVersion: string,
  granted = true,
) {
  return authJSON<{
    consent_type: string;
    consent_version: string;
    granted: boolean;
  }>("POST", "/v1/consent/grant", {
    consent_type: consentType,
    consent_version: consentVersion,
    granted,
  });
}

/** Both KVKK purposes required before map / geolocation. */
export function hasRequiredConsents(status: ConsentStatusResponse): boolean {
  const disclosure = status.consents.aydinlatma_metni;
  const location = status.consents.acik_riza_location;
  return Boolean(disclosure?.granted) && Boolean(location?.granted);
}
