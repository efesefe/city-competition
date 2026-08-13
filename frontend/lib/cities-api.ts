import { API_BASE, ApiError } from "@/lib/auth-api";
import { getSessionToken } from "@/lib/session";

export type CityCentroid = {
  lng: number;
  lat: number;
};

export type CompetingTribe = {
  tribe_id: string;
  committed_credits: number;
};

export type ControllingTribe = {
  tribe_id: string;
  primary_color?: string | null;
} | null;

export type City = {
  id: string;
  name: string;
  centroid: CityCentroid;
  controlling_tribe: ControllingTribe;
  competing_tribes: CompetingTribe[];
  flips_today?: number;
  current_streak_days?: number;
  contest_tension?: number;
};

export type CitiesListResponse = {
  cities: City[];
};

async function authJSON<T>(method: string, path: string): Promise<T> {
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

export function fetchCities() {
  return authJSON<CitiesListResponse>("GET", "/v1/cities");
}
