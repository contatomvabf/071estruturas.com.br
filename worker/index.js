export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowedOrigin = resolveAllowedOrigin(origin, env);
    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigin || "null",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    };

    if (!allowedOrigin) {
      return jsonResponse({ ok: false, error: "Origin nao permitido" }, 403, corsHeaders);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return jsonResponse({ ok: false, error: "Method not allowed" }, 405, corsHeaders);
    }

    let body;
    try {
      body = await request.json();
    } catch (_) {
      body = null;
    }

    if (!body) {
      const form = await request.formData().catch(function () {
        return null;
      });
      if (form) {
        body = Object.fromEntries(form.entries());
      }
    }

    if (!body) {
      return jsonResponse({ ok: false, error: "Invalid request body" }, 400, corsHeaders);
    }

    const nome = String(body.nome || "").trim();
    const email = String(body.email || "").trim();
    const mensagem = String(body.mensagem || "").trim();
    const turnstileToken = String(body["cf-turnstile-response"] || "").trim();

    if (!nome || !email || !mensagem) {
      return jsonResponse({ ok: false, error: "Campos obrigatorios ausentes" }, 400, corsHeaders);
    }

    if (!turnstileToken) {
      return jsonResponse({ ok: false, error: "Token Turnstile ausente" }, 400, corsHeaders);
    }

    const ip = request.headers.get("CF-Connecting-IP") || "";
    const verification = await verifyTurnstile(turnstileToken, ip, env);
    if (!verification.success) {
      return jsonResponse(
        { ok: false, error: "Falha na verificacao antispam", details: verification["error-codes"] || [] },
        403,
        corsHeaders
      );
    }

    const contactTarget = env.FORMSUBMIT_ENDPOINT || "https://formsubmit.co/ajax/071estruturas@gmail.com";
    const senderEmail = env.SENDER_EMAIL || "071estruturas@gmail.com";
    const outgoing = new FormData();
    outgoing.append("nome", nome);
    outgoing.append("email", senderEmail);
    outgoing.append("_replyto", email);
    outgoing.append("email_cliente", email);
    outgoing.append("mensagem", mensagem);
    outgoing.append("_subject", String(body._subject || "Contato site 071 Estruturas"));
    outgoing.append("_template", "table");
    outgoing.append("_captcha", "false");

    const sendRes = await fetch(contactTarget, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: outgoing,
    });

    if (!sendRes.ok) {
      return jsonResponse({ ok: false, error: "Falha ao encaminhar mensagem" }, 502, corsHeaders);
    }

    return jsonResponse({ ok: true }, 200, corsHeaders);
  },
};

async function verifyTurnstile(token, ip, env) {
  if (!env.TURNSTILE_SECRET_KEY) {
    return { success: false, "error-codes": ["missing-secret"] };
  }

  const payload = new URLSearchParams();
  payload.set("secret", env.TURNSTILE_SECRET_KEY);
  payload.set("response", token);
  if (ip) payload.set("remoteip", ip);

  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: payload,
  });

  if (!res.ok) {
    return { success: false, "error-codes": ["verification-request-failed"] };
  }

  return res.json();
}

function jsonResponse(data, status, extraHeaders) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}

function resolveAllowedOrigin(origin, env) {
  const exact = String(env.ALLOWED_ORIGIN || "").trim();
  const listRaw = String(env.ALLOWED_ORIGINS || "").trim();

  if (exact) {
    return origin === exact ? exact : "";
  }

  if (listRaw) {
    const list = listRaw
      .split(",")
      .map(function (x) {
        return x.trim();
      })
      .filter(Boolean);
    return list.indexOf(origin) >= 0 ? origin : "";
  }

  // Fallback seguro: para dev local, permita localhost; em producao, configure ALLOWED_ORIGIN(S).
  if (
    origin === "http://localhost:3000" ||
    origin === "http://127.0.0.1:3000" ||
    origin === "http://localhost:5500" ||
    origin === "http://127.0.0.1:5500"
  ) {
    return origin;
  }

  return "";
}
