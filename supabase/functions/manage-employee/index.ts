import { createClient } from "npm:@supabase/supabase-js@2.116.0";

const corsHeaders = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const productionOrigin = "https://famproeventsvercel.vercel.app";
const allowedOrigins = new Set([
  productionOrigin,
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]);

function responseHeaders(request: Request) {
  const origin = request.headers.get("origin") ?? "";
  return {
    ...corsHeaders,
    "Access-Control-Allow-Origin": allowedOrigins.has(origin) ? origin : productionOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
    "Vary": "Origin",
  };
}

function json(request: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(request) });
}

function text(value: unknown, maximum: number) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function configuredKey(jsonName: string, legacyName: string) {
  const values = JSON.parse(Deno.env.get(jsonName) ?? "{}");
  return values.default ?? Object.values(values)[0] ?? Deno.env.get(legacyName);
}

function normalizedPermissions(value: unknown) {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  return {
    reservations: input.reservations === true,
    clients: input.clients === true,
    stock: input.stock === true,
    paiements: input.paiements === true,
    rapports: input.rapports === true,
  };
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: responseHeaders(request) });
  }
  if (request.method !== "POST") return json(request, { error: "Méthode refusée." }, 405);

  const contentLength = Number(request.headers.get("content-length") || 0);
  if (contentLength > 8_192) return json(request, { error: "Demande trop volumineuse." }, 413);

  let invitedUserId: string | null = null;
  try {
    const authorization = request.headers.get("authorization") ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
    if (!token) return json(request, { error: "Authentification requise." }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const secretKey = configuredKey("SUPABASE_SECRET_KEYS", "SUPABASE_SERVICE_ROLE_KEY");
    const publishableKey = configuredKey("SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_ANON_KEY");
    if (!supabaseUrl || !secretKey || !publishableKey) {
      throw new Error("Configuration serveur incomplète");
    }

    const admin = createClient(supabaseUrl, String(secretKey), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: callerResult, error: callerError } = await admin.auth.getUser(token);
    if (callerError || !callerResult.user) {
      return json(request, { error: "Session invalide." }, 401);
    }

    const { data: callerAccount, error: accountError } = await admin
      .from("staff_accounts")
      .select("id,role,active")
      .eq("auth_user_id", callerResult.user.id)
      .maybeSingle();
    if (accountError || !callerAccount?.active || callerAccount.role !== "admin") {
      return json(request, { error: "Accès administrateur requis." }, 403);
    }

    const raw = await request.text();
    if (raw.length > 8_192) return json(request, { error: "Demande trop volumineuse." }, 413);
    const input = JSON.parse(raw) as Record<string, unknown>;
    const action = text(input.action, 20);

    const caller = createClient(supabaseUrl, String(publishableKey), {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    if (action === "invite") {
      const nom = text(input.nom, 120);
      const email = text(input.email, 254).toLowerCase();
      const telephone = text(input.telephone, 30) || null;
      const permissions = normalizedPermissions(input.permissions);
      if (nom.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return json(request, { error: "Nom ou adresse e-mail invalide." }, 400);
      }

      const { data: invitation, error: invitationError } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: `${productionOrigin}/login.html`,
        data: { nom },
      });
      if (invitationError || !invitation.user) {
        return json(request, { error: invitationError?.message ?? "Invitation impossible." }, 400);
      }
      invitedUserId = invitation.user.id;

      const { error: registrationError } = await caller.rpc("admin_register_staff_account", {
        p_auth_user_id: invitation.user.id,
        p_email: email,
        p_nom: nom,
        p_telephone: telephone,
        p_permissions: permissions,
      });
      if (registrationError) {
        await admin.auth.admin.deleteUser(invitation.user.id, false);
        invitedUserId = null;
        throw registrationError;
      }
      invitedUserId = null;
      return json(request, { ok: true }, 201);
    }

    if (action === "toggle") {
      const id = text(input.id, 36);
      const active = input.active;
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
          || typeof active !== "boolean") {
        return json(request, { error: "Modification invalide." }, 400);
      }
      const { error } = await caller.rpc("admin_set_staff_active", {
        p_staff_id: id,
        p_active: active,
      });
      if (error) throw error;
      return json(request, { ok: true });
    }

    return json(request, { error: "Action inconnue." }, 400);
  } catch (error) {
    if (invitedUserId) {
      console.error("manage-employee orphan invitation", invitedUserId);
    }
    console.error("manage-employee", error instanceof Error ? error.message : String(error));
    return json(request, { error: "Service temporairement indisponible." }, 500);
  }
});
