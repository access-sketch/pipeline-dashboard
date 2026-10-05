/**
 * Everything specific to one business comes from environment variables,
 * so the same code can be deployed for any client.
 */
function required(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set in Vercel`);
  return v;
}

export const config = {
  ghlToken: () => required("GHL_TOKEN"),
  ghlLocationId: () => required("GHL_LOCATION_ID"),
  metaToken: () => required("META_ACCESS_TOKEN"),
  /** Accepts "123", "act_123" or a full Ads Manager URL. */
  metaAdAccountId: () => {
    const raw = required("META_AD_ACCOUNT_ID");
    const m = raw.match(/(?:act[_=])?(\d{6,})/);
    return m ? m[1] : raw;
  },
  title: () => process.env.DASHBOARD_TITLE?.trim() || "Ads & pipeline",
};

/** Contacts that never count as leads (comma-separated in EXCLUDED_EMAILS / EXCLUDED_EMAIL_DOMAINS). */
export function excluded() {
  const list = (k: string) =>
    (process.env[k] ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  return { emails: list("EXCLUDED_EMAILS"), domains: list("EXCLUDED_EMAIL_DOMAINS") };
}
export const TEST_NAME_PATTERN = /\b(test|tester|testing)\b/i;
