// Structured invocation logging: one JSON line per /v1 request.
//
// This is the gateway's only telemetry, and it is local — lines go to your
// stdout (or a sink you pass in). Nothing is sent anywhere. The shape is the
// same one Mailsnail's managed API uses to measure first-try invocation
// success, so self-hosters get the same observability for free:
//
//   {"evt":"invocation","tool":"POST /v1/letters","status":200,"ok":true,
//    "duration_ms":812,"kind":"certified_letter","provider":"click2mail",
//    "mode":"TEST","ts":"2026-07-03T17:00:00.000Z"}

function pieceKind(req) {
  if (req.path.startsWith("/v1/postcards")) return "postcard";
  if (req.path.startsWith("/v1/letters") || req.path.startsWith("/v1/preview")) {
    return req.body?.extra_service === "certified" ||
      req.body?.extra_service === "certified_return_receipt"
      ? "certified_letter"
      : "letter";
  }
  return undefined;
}

export function invocationLogger({ provider, log } = {}) {
  const sink = log ?? ((line) => console.log(JSON.stringify(line)));
  return (req, res, next) => {
    if (!req.path.startsWith("/v1/")) return next();
    // Proof fetches are page views, not invocations.
    if (req.method === "GET" && req.path.startsWith("/v1/preview/")) return next();
    const start = Date.now();
    res.on("finish", () => {
      sink({
        evt: "invocation",
        tool: `${req.method} ${req.path.replace(/\/[^/]{8,}$/, "/:id")}`,
        status: res.statusCode,
        ok: res.statusCode < 400,
        duration_ms: Date.now() - start,
        kind: pieceKind(req),
        provider: provider?.name,
        mode: provider?.isLive ? "LIVE" : "TEST",
        ts: new Date().toISOString(),
      });
    });
    next();
  };
}
