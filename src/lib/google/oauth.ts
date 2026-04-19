import { createServiceClient } from "@/lib/supabase/server";
import type { GoogleOAuthTokens } from "@/types/database";

export const GOOGLE_CALENDAR_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
];

const AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT =
  "https://www.googleapis.com/oauth2/v2/userinfo";

// Refresh a bit early to avoid racing expiry.
const EXPIRY_SKEW_MS = 60_000;

function requireEnv(...names: string[]): string {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  throw new Error(`Missing env var (tried: ${names.join(", ")})`);
}

export function getRedirectUri(origin?: string): string {
  const fromEnv =
    process.env.GOOGLE_REDIRECT_URI ?? process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (fromEnv) return fromEnv;
  if (origin) return `${origin}/api/auth/google/callback`;
  throw new Error(
    "Cannot determine OAuth redirect URI — set GOOGLE_REDIRECT_URI or call with a request origin."
  );
}

export function buildAuthUrl(state: string, origin?: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_CLIENT_ID"),
    redirect_uri: getRedirectUri(origin),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: GOOGLE_CALENDAR_SCOPES.join(" "),
    state,
  });
  return `${AUTH_BASE}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
  id_token?: string;
}

export async function exchangeCodeForTokens(
  code: string,
  origin?: string
): Promise<{
  tokens: TokenResponse;
  email: string;
}> {
  const body = new URLSearchParams({
    code,
    client_id: requireEnv("GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_CLIENT_ID"),
    client_secret: requireEnv("GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"),
    redirect_uri: getRedirectUri(origin),
    grant_type: "authorization_code",
  });

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  }
  const tokens = (await res.json()) as TokenResponse;

  const userRes = await fetch(USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userRes.ok) {
    throw new Error(`Userinfo fetch failed: ${userRes.status}`);
  }
  const { email } = (await userRes.json()) as { email: string };
  return { tokens, email };
}

export async function saveTokens(
  email: string,
  tokens: TokenResponse,
  existingRefreshToken?: string
): Promise<void> {
  const supabase = createServiceClient();
  const expires_at = new Date(
    Date.now() + tokens.expires_in * 1000
  ).toISOString();
  const refresh_token = tokens.refresh_token ?? existingRefreshToken;
  if (!refresh_token) {
    throw new Error(
      "Google did not return a refresh_token and none is on file. Re-consent with prompt=consent."
    );
  }

  const { error } = await supabase.from("google_oauth_tokens").upsert(
    {
      email,
      access_token: tokens.access_token,
      refresh_token,
      scope: tokens.scope,
      token_type: tokens.token_type,
      expires_at,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "email" }
  );
  if (error) throw new Error(`Failed to persist tokens: ${error.message}`);
}

async function refreshAccessToken(
  row: GoogleOAuthTokens
): Promise<GoogleOAuthTokens> {
  const body = new URLSearchParams({
    client_id: requireEnv("GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_CLIENT_ID"),
    client_secret: requireEnv("GOOGLE_OAUTH_CLIENT_SECRET", "GOOGLE_CLIENT_SECRET"),
    grant_type: "refresh_token",
    refresh_token: row.refresh_token,
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  }
  const tokens = (await res.json()) as TokenResponse;
  await saveTokens(row.email, tokens, row.refresh_token);
  return {
    ...row,
    access_token: tokens.access_token,
    expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
  };
}

export async function getStoredTokens(): Promise<GoogleOAuthTokens | null> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("google_oauth_tokens")
    .select("*")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as GoogleOAuthTokens | null) ?? null;
}

export async function getValidAccessToken(): Promise<{
  accessToken: string;
  email: string;
} | null> {
  const row = await getStoredTokens();
  if (!row) return null;
  const expiresMs = new Date(row.expires_at).getTime();
  if (Date.now() + EXPIRY_SKEW_MS < expiresMs) {
    return { accessToken: row.access_token, email: row.email };
  }
  const refreshed = await refreshAccessToken(row);
  return { accessToken: refreshed.access_token, email: refreshed.email };
}
