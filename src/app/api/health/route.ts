import { NextResponse } from "next/server";
import { checkDatabase } from "@/server/health";

export const dynamic = "force-dynamic";

export async function GET() {
  const dbOk = await checkDatabase();
  return NextResponse.json({ ok: dbOk, db: dbOk ? "up" : "down" }, { status: dbOk ? 200 : 503 });
}
