import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface PaymentProviderConfig {
  name: string;
  apiKey: string;
  merchantId: string | null;
  webhookSecret: string | null;
}

function getProviderConfig(): PaymentProviderConfig | null {
  const name = Deno.env.get("PAYMENT_PROVIDER");
  const apiKey = Deno.env.get("PAYMENT_PROVIDER_SECRET");
  if (!name || !apiKey) return null;
  return {
    name,
    apiKey,
    merchantId: Deno.env.get("PAYMENT_MERCHANT_ID") ?? null,
    webhookSecret: Deno.env.get("PAYMENT_WEBHOOK_SECRET") ?? null,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const providerConfig = getProviderConfig();
  if (!providerConfig) {
    return new Response(
      JSON.stringify({
        error:
          "Payment provider is not configured. Set PAYMENT_PROVIDER and PAYMENT_PROVIDER_SECRET as edge function secrets.",
      }),
      {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(
      JSON.stringify({ error: "Authentication required" }),
      {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: authError,
  } = await userClient.auth.getUser();

  if (authError || !user) {
    return new Response(
      JSON.stringify({ error: "Authentication required" }),
      {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  let body: { orderId?: string; paymentMethod?: string; walletType?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid request body" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const orderId = body.orderId;
  if (!orderId) {
    return new Response(
      JSON.stringify({ error: "Order ID is required" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const paymentMethod = body.paymentMethod;
  if (!paymentMethod || !["instapay", "mobile_wallet"].includes(paymentMethod)) {
    return new Response(
      JSON.stringify({ error: "Invalid payment method. Supported: instapay, mobile_wallet" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const walletType = body.walletType;

  const serviceClient = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false },
  });

  const { data: order, error: orderError } = await serviceClient
    .from("orders")
    .select("id, sender_id, status, total_amount, currency, order_number")
    .eq("id", orderId)
    .maybeSingle();

  if (orderError || !order) {
    return new Response(
      JSON.stringify({ error: "Order not found" }),
      {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  if (order.sender_id !== user.id) {
    return new Response(
      JSON.stringify({ error: "Unauthorized: only the sender can pay for this order" }),
      {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  if (order.status !== "awaiting_payment") {
    return new Response(
      JSON.stringify({ error: `Order is not awaiting payment (current: ${order.status})` }),
      {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const { data: existingPayment } = await serviceClient
    .from("payments")
    .select("id, status")
    .eq("order_id", orderId)
    .in("status", ["held", "released", "paid"])
    .maybeSingle();

  if (existingPayment) {
    return new Response(
      JSON.stringify({ error: "Order already has a completed payment" }),
      {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const amount = Number(order.total_amount);
  if (amount <= 0) {
    return new Response(
      JSON.stringify({ error: "Invalid payment amount" }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const providerReference = paymentMethod === "mobile_wallet" && walletType
    ? walletType
    : paymentMethod;

  const { error: rpcError } = await serviceClient.rpc("initiate_payment", {
    p_order_id: order.id,
    p_payment_method: paymentMethod,
    p_provider_session_id: null,
  });

  if (rpcError) {
    return new Response(
      JSON.stringify({ error: rpcError.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  const { data: payment, error: paymentError } = await serviceClient
    .from("payments")
    .select("id, provider_session_id")
    .eq("order_id", orderId)
    .eq("status", "pending")
    .maybeSingle();

  if (paymentError || !payment) {
    return new Response(
      JSON.stringify({ error: "Failed to retrieve initiated payment" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  await serviceClient
    .from("payments")
    .update({
      provider: providerConfig.name,
      provider_reference: providerReference,
    })
    .eq("id", payment.id);

  const origin = req.headers.get("Origin") ?? req.headers.get("Referer") ?? "https://example.com";
  const callbackUrl = `${origin}/dashboard/orders/${order.id}?payment=success`;
  const cancelUrl = `${origin}/dashboard/orders/${order.id}?payment=cancelled`;

  let providerResponse: { url?: string; reference?: string };

  try {
    providerResponse = await createProviderPaymentSession({
      config: providerConfig,
      amount,
      currency: order.currency,
      orderNumber: order.order_number,
      orderId: order.id,
      paymentId: payment.id,
      paymentMethod,
      walletType: walletType ?? null,
      callbackUrl,
      cancelUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown provider error";
    return new Response(
      JSON.stringify({ error: `Failed to create payment session: ${message}` }),
      {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }

  if (providerResponse.url) {
    await serviceClient
      .from("payments")
      .update({ provider_session_id: providerResponse.reference ?? null })
      .eq("id", payment.id);
  }

  return new Response(
    JSON.stringify({
      url: providerResponse.url,
      reference: providerResponse.reference,
      paymentId: payment.id,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});

interface CreateSessionParams {
  config: PaymentProviderConfig;
  amount: number;
  currency: string;
  orderNumber: string;
  orderId: string;
  paymentId: string;
  paymentMethod: string;
  walletType: string | null;
  callbackUrl: string;
  cancelUrl: string;
}

async function createProviderPaymentSession(params: CreateSessionParams): Promise<{ url?: string; reference?: string }> {
  const { config, amount, currency, orderNumber, orderId, paymentId, paymentMethod, walletType, callbackUrl, cancelUrl } = params;

  const requestBody: Record<string, unknown> = {
    amount,
    currency,
    merchant_reference: orderId,
    payment_reference: paymentId,
    description: `Order ${orderNumber}`,
    callback_url: callbackUrl,
    cancel_url: cancelUrl,
    payment_method: paymentMethod,
  };

  if (paymentMethod === "mobile_wallet" && walletType) {
    requestBody.wallet_type = walletType;
  }

  const response = await fetch(
    `https://api.${config.name}.com/v1/payments/session`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
        ...(config.merchantId ? { "X-Merchant-Id": config.merchantId } : {}),
      },
      body: JSON.stringify(requestBody),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Provider API error (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return {
    url: data.checkout_url ?? data.payment_url ?? undefined,
    reference: data.reference ?? data.payment_id ?? data.id ?? undefined,
  };
}
