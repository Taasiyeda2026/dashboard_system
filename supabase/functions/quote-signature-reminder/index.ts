import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const DASHBOARD_URL = "https://taasiyeda2026.github.io/dashboard_system/";
const CRON_SECRET_SHA256 = "49439b1109691d8feaddbd05de36aef679e89e75bb58c146222e0fe174e747e0";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  });
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function israelHour() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());

  return Number(parts.find((part) => part.type === "hour")?.value ?? "-1");
}

async function getGraphAccessToken() {
  const tenantId = Deno.env.get("MS_TENANT_ID");
  const clientId = Deno.env.get("MS_CLIENT_ID");
  const clientSecret = Deno.env.get("MS_CLIENT_SECRET");

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("Microsoft Graph credentials are not configured");
  }

  const response = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    },
  );

  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Microsoft Graph token request failed: ${response.status} ${details}`);
  }

  const payload = await response.json();
  if (!payload?.access_token) {
    throw new Error("Microsoft Graph token response did not include an access token");
  }

  return String(payload.access_token);
}

async function supabaseRequest(path: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Supabase service credentials are not configured");
  }

  return fetch(`${supabaseUrl}${path}`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  });
}

Deno.serve(async (request: Request) => {
  try {
    if (request.method !== "POST") {
      return json({ ok: false, error: "Method not allowed" }, 405);
    }

    const cronSecret = request.headers.get("x-cron-secret") ?? "";
    if (!cronSecret || (await sha256(cronSecret)) !== CRON_SECRET_SHA256) {
      return json({ ok: false, error: "Unauthorized" }, 401);
    }

    const hour = israelHour();
    if (hour < 9 || hour > 16) {
      return json({
        ok: true,
        sent: false,
        reason: "outside_reminder_hours",
        israel_hour: hour,
      });
    }

    const quoteUrl = new URL("/rest/v1/proposals_agreements", Deno.env.get("SUPABASE_URL"));
    quoteUrl.searchParams.set("select", "id");
    quoteUrl.searchParams.set("status", "eq.pending_approval");
    quoteUrl.searchParams.set("document_type", "eq.הצעת מחיר");
    quoteUrl.searchParams.set("archived_at", "is.null");

    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!serviceRoleKey) {
      throw new Error("Supabase service credentials are not configured");
    }

    const countResponse = await fetch(quoteUrl, {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        Prefer: "count=exact",
        Range: "0-0",
      },
    });

    if (!countResponse.ok) {
      const details = await countResponse.text();
      throw new Error(`Could not count pending quotes: ${countResponse.status} ${details}`);
    }

    const contentRange = countResponse.headers.get("content-range") ?? "";
    const totalText = contentRange.split("/")[1] ?? "0";
    const pendingCount = /^\d+$/.test(totalText) ? Number(totalText) : 0;

    if (pendingCount === 0) {
      return json({ ok: true, sent: false, reason: "no_pending_quotes", count: 0 });
    }

    const approversResponse = await supabaseRequest(
      "/rest/v1/users?select=email,auth_email&approve_proposals_agreements=eq.true&is_active=eq.true",
    );

    if (!approversResponse.ok) {
      const details = await approversResponse.text();
      throw new Error(`Could not load proposal approvers: ${approversResponse.status} ${details}`);
    }

    const approvers = await approversResponse.json();
    const recipients = Array.from(
      new Set(
        (Array.isArray(approvers) ? approvers : [])
          .map((user: { email?: string | null; auth_email?: string | null }) =>
            String(user.email || user.auth_email || "").trim()
          )
          .filter(Boolean),
      ),
    );

    if (recipients.length === 0) {
      throw new Error("No active proposal approver email is configured");
    }

    const sender = Deno.env.get("MS_MAIL_SENDER");
    if (!sender) {
      throw new Error("MS_MAIL_SENDER is not configured");
    }

    const accessToken = await getGraphAccessToken();
    const reminderText = pendingCount === 1
      ? "ממתינה לך כעת הצעת מחיר אחת לחתימה."
      : `ממתינות לך כעת ${pendingCount} הצעות מחיר לחתימה.`;

    const mailResponse = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            subject: "תזכורת: הצעות מחיר ממתינות לחתימה",
            body: {
              contentType: "HTML",
              content: `
                <div dir="rtl" style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#1f2937">
                  <p>${reminderText}</p>
                  <p><a href="${DASHBOARD_URL}">לצפייה בדשבורד</a></p>
                </div>
              `,
            },
            toRecipients: recipients.map((address) => ({
              emailAddress: { address },
            })),
          },
          saveToSentItems: false,
        }),
      },
    );

    if (!mailResponse.ok) {
      const details = await mailResponse.text();
      throw new Error(`Reminder email failed: ${mailResponse.status} ${details}`);
    }

    return json({
      ok: true,
      sent: true,
      count: pendingCount,
      recipients: recipients.length,
    });
  } catch (error) {
    console.error("quote-signature-reminder failed", error);
    return json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      500,
    );
  }
});
