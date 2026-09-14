async function runSync(env: Env, trigger: "cron" | "manual") {
  const response = await fetch(env.SYNC_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.SYNC_SECRET}`,
      "Content-Type": "application/json",
      "User-Agent": "dalaieej-reconciliation-scheduler/1.0",
    },
  });

  console.log(
    JSON.stringify({
      level: response.ok ? "info" : "error",
      message: "reconciliation_sync_request_completed",
      trigger,
      status: response.status,
    }),
  );

  if (!response.ok) {
    throw new Error(`Reconciliation sync returned HTTP ${response.status}`);
  }
}

export default {
  async scheduled(_controller, env): Promise<void> {
    await runSync(env, "cron");
  },

  async fetch(request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, schedule: "every-five-minutes" });
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
