// lib/username.ts
// Shared between every place a username gets validated or turned into the
// synthetic auth email backing it — the create-player and
// rename-player-username API routes, and the client-side login screen.
// Keeping this in one place means those can never quietly drift apart on
// what counts as a valid username or how the synthetic email is built.

// 3-32 chars, letters/numbers/. _ -, can't start or end with a symbol.
export const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/i;

export function isValidUsername(username: string): boolean {
  return USERNAME_RE.test(username);
}

// See supabase/migrations/0016_player_username_login.sql for why this is a
// real (if synthetic) address: Supabase's Auth system requires an email
// internally, so username-based accounts get one deterministically derived
// from the username itself, under the IANA-reserved-for-this-purpose
// `.invalid` TLD (RFC 2606) — never delivered anywhere.
export function syntheticEmailForUsername(username: string): string {
  return `${username.toLowerCase()}@players.invalid`;
}
