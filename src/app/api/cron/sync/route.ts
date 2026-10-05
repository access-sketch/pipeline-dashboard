import { NextRequest } from "next/server";
import { sendAlert } from "@/lib/alert";
import { syncAll } from "@/lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Called by Vercel Cron once a day (see vercel.json).
 * Manual reload: curl -H "Authorization: Bearer $CRON_SECRET" "https://YOUR-DOMAIN/api/cron/sync?days=90"
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days")) || 14, 1), 120);
  const result = await syncAll({ days, trigger: req.nextUrl.searchParams.get("days") ? "manual" : "cron" });
  if (!result.ok) {
    const failed = result.steps.filter((s) => !s.ok).map((s) => `• ${s.step}: ${s.error}`);
    await sendAlert(`Dashboard sync failed\n${failed.join("\n")}\n<${req.nextUrl.origin}|Open the dashboard>`);
  }
  return Response.json(result, { status: result.ok ? 200 : 207 });
}
