import { NextRequest, NextResponse } from "next/server";
import { syncAll } from "@/lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** "Refresh now" button (last 3 days) and first-time load (?days=90). Protected by the dashboard password. */
export async function POST(req: NextRequest) {
  const days = Math.min(Math.max(Number(req.nextUrl.searchParams.get("days")) || 3, 1), 120);
  await syncAll({ days, trigger: "button" });
  return NextResponse.redirect(new URL("/", req.url), 303);
}
