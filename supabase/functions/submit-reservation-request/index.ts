import { createClient } from "@supabase/supabase-js";
import { corsHeaders } from "@supabase/supabase-js/cors";

const allowedOrigins = new Set([
  "https://famproeventsvercel.vercel.app",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]);

function responseHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  const allowedOrigin = allowedOrigins.has(origin)
    ? origin
    : "https://famproeventsvercel.vercel.app";
  return {
    ...corsHeaders,
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(request),
  });
}

function text(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function optionalNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function hashRequestIdentity(secret: string, request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-real-ip")
    ?? forwarded
    ?? "unknown";
  const bytes = new TextEncoder().encode(`${secret}:${address}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: responseHeaders(request) });
  }
  if (request.method !== "POST") return json(request, { error: "Méthode refusée." }, 405);

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 16_384) return json(request, { error: "Demande trop volumineuse." }, 413);

  try {
    const raw = await request.text();
    if (raw.length > 16_384) return json(request, { error: "Demande trop volumineuse." }, 413);
    const input = JSON.parse(raw);
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return json(request, { error: "Demande invalide." }, 400);
    }
    if (text(input.website, 200)) return json(request, { ok: true }, 202);

    const idempotencyKey = text(input.idempotency_key, 64);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) {
      return json(request, { error: "Identifiant de demande invalide." }, 400);
    }

    const payload = {
      nom: text(input.nom, 120),
      telephone: text(input.telephone, 30),
      email: text(input.email, 254) || null,
      type_evenement: text(input.type_evenement, 80),
      date_souhaitee: text(input.date_souhaitee, 10) || null,
      lieu: text(input.lieu, 180) || null,
      message: text(input.message, 1000) || null,
      latitude: optionalNumber(input.latitude),
      longitude: optionalNumber(input.longitude),
    };
    if (payload.nom.length < 2 || payload.telephone.length < 6 || payload.type_evenement.length < 2) {
      return json(request, { error: "Complétez les champs obligatoires." }, 400);
    }

    const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") ?? "{}");
    const secretKey = secretKeys.default ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!secretKey || !supabaseUrl) throw new Error("Configuration serveur incomplète");
    const admin = createClient(supabaseUrl, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    let clientUserId: string | null = null;
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (token && !token.startsWith("sb_publishable_")) {
      const { data } = await admin.auth.getUser(token);
      clientUserId = data.user?.id ?? null;
    }

    const requestHash = await hashRequestIdentity(secretKey, request);
    const { data, error } = await admin.rpc("submit_public_reservation_request", {
      p_payload: payload,
      p_request_hash: requestHash,
      p_idempotency_key: idempotencyKey,
      p_client_user_id: clientUserId,
    });
    if (error) {
      const limited = /Trop de demandes/i.test(error.message || "");
      return json(request, {
        error: limited
          ? "Trop de demandes. Réessayez dans quelques minutes."
          : "Impossible d’enregistrer la demande.",
      }, limited ? 429 : 400);
    }
    return json(request, { ok: true, id: data }, 201);
  } catch (error) {
    console.error("submit-reservation-request", error instanceof Error ? error.message : String(error));
    return json(request, { error: "Service temporairement indisponible." }, 500);
  }
});
