import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey, X-Webhook-Signature",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const webhookSecret = Deno.env.get("PAYMENT_WEBHOOK_SECRET");
  const providerName = Deno.env.get("PAYMENT_PROVIDER");

  if (!webhookSecret || !providerName) {
    return new Response(
      JSON.stringify({
        error:
          "Payment webhook is not configured. Set PAYMENT_PROVIDER and PAYMENT_WEBHOOK_SECRET as edge function secrets.",
      }),
      {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const signature = req.headers.get("X-Webhook-Signature");
  if (!signature) {
    return new Response(
      JSON.stringify({ error: "Missing X-Webhook-Signature header" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const rawBody = await req.text();

  if (!verifyWebhookSignature(rawBody, signature, webhookSecret)) {
    return new Response(
      JSON.stringify({ error: "Webhook signature verification failed" }),
      {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  let event: {
    event_id: string;
    event_type: string;
    payment_id: string;
    provider_payment_id: string;
    amount: number;
    currency: string;
    status: string;
    failure_reason?: string;
  };

  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  if (!event.event_id || !event.event_type || !event.payment_id) {
    return new Response(
      JSON.stringify({ error: "Missing required event fields" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const { data: existingEvent } = await supabase
    .from("webhook_events")
    .select("id")
    .eq("provider", providerName)
    .eq("event_id", event.event_id)
    .maybeSingle();

  if (existingEvent) {
    return new Response(
      JSON.stringify({ received: true, message: "Event already processed" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { error: insertEventError } = await supabase
    .from("webhook_events")
    .insert({
      provider: providerName,
      event_id: event.event_id,
      event_type: event.event_type,
    });

  if (insertEventError) {
    if (insertEventError.code === "23505") {
      return new Response(
        JSON.stringify({ received: true, message: "Event already processed (race)" }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ error: "Failed to record webhook event" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    switch (event.event_type) {
      case "payment.succeeded":
      case "payment.held": {
        const { data: payment } = await supabase
          .from("payments")
          .select("id, status")
          .eq("id", event.payment_id)
          .maybeSingle();

        if (!payment) {
          return new Response(
            JSON.stringify({ received: true, message: "No matching payment" }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        if (payment.status === "held" || payment.status === "released" || payment.status === "paid") {
          return new Response(
            JSON.stringify({ received: true, message: "Payment already in terminal state" }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const { error } = await supabase.rpc("process_provider_payment", {
          p_payment_id: payment.id,
          p_provider_payment_id: event.provider_payment_id,
          p_provider_event_id: event.event_id,
          p_amount: event.amount,
          p_currency: event.currency?.toUpperCase() ?? null,
        });

        if (error) {
          return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        break;
      }

      case "payment.failed": {
        const { data: payment } = await supabase
          .from("payments")
          .select("id")
          .eq("id", event.payment_id)
          .maybeSingle();

        if (!payment) {
          return new Response(
            JSON.stringify({ received: true, message: "No matching payment" }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const { error } = await supabase.rpc("mark_payment_failed", {
          p_payment_id: payment.id,
          p_provider_event_id: event.event_id,
          p_failure_reason: event.failure_reason ?? "Payment failed",
        });

        if (error) {
          return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        break;
      }

      case "payment.cancelled":
      case "payment.expired": {
        const { data: payment } = await supabase
          .from("payments")
          .select("id, status")
          .eq("id", event.payment_id)
          .maybeSingle();

        if (!payment) {
          return new Response(
            JSON.stringify({ received: true, message: "No matching payment" }),
            { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        if (payment.status === "pending" || payment.status === "processing") {
          const { error } = await supabase.rpc("mark_payment_failed", {
            p_payment_id: payment.id,
            p_provider_event_id: event.event_id,
            p_failure_reason: event.event_type === "payment.expired"
              ? "Payment session expired"
              : "Payment cancelled",
          });

          if (error) {
            return new Response(
              JSON.stringify({ error: error.message }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
        }

        break;
      }

      default:
        return new Response(
          JSON.stringify({ received: true, message: `Unhandled event type: ${event.event_type}` }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
    }

    return new Response(
      JSON.stringify({ received: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});

async function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
  const expected = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return signature === expected || timingSafeEqual(signature, expected);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
