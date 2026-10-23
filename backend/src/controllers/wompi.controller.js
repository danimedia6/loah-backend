import axios from "axios"
import supabase from "../config/supabaseClient.js"

const WOMPI_URL =
  process.env.WOMPI_ENV === "production"
    ? "https://production.wompi.co/v1"
    : "https://sandbox.wompi.co/v1"

export async function crearTransaccion(req, res) {
  try {
    const { id_pedido, total } = req.body

    if (!id_pedido || !total) {
      return res.status(400).json({ error: "Datos incompletos" })
    }

    const amountInCents = Math.round(Number(total) * 100)

    // 1) Crear Payment Link en Wompi
    const createResp = await axios.post(
      `${WOMPI_URL}/payment_links`,
      {
        name: `Pedido #${id_pedido}`,
        description: "Pago de consumo en Santa Palma",
        amount_in_cents: amountInCents,
        currency: "COP",
        redirect_url: `${process.env.FRONTEND_URL}/pago-resultado?id=${id_pedido}`,
        single_use: true,
        collect_shipping: false
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WOMPI_PRIVATE_KEY}`,
          "Content-Type": "application/json"
        }
      }
    )

    console.log("🧾 Pago creado:")

    const linkId = createResp.data?.data?.id
    if (!linkId) {
      throw new Error("Wompi no devolvió ID del payment_link")
    }

    // 2) Guardar relación pago–pedido en tabla pagos
    await supabase.from("pagos").insert({
      id_pedido,
      payment_link_id: linkId, // 👈 OBLIGATORIO
      amount: amountInCents,
      currency: "COP",
      status: "PENDING",
      transaction_id: null,
      raw: createResp.data
    })


    // 3) URL de checkout de Wompi
    const checkoutUrl = `https://checkout.wompi.co/l/${linkId}`

    return res.json({ checkoutUrl })
  } catch (error) {
    console.error("❌ Error creando link de pago:")
    return res.status(500).json({ error: "Error creando link de pago" })
  }
}
export async function webhookWompi(req, res) {
  try {
    // Si viene como Buffer (porque el endpoint usa express.raw)
    let body = req.body
    if (body instanceof Buffer) {
      try {
        body = JSON.parse(body.toString("utf8"))
      } catch (e) {
        console.error("❌ Error parseando raw webhook:")
        return res.status(400).json({ error: "Body inválido" })
      }
    }

    console.log("📩 Webhook recibido:")

    const event = body?.event
    const tx = body?.data?.transaction

    if (!event || !tx) {
      console.warn("⚠ Webhook sin event o sin data.transaction")
      return res.status(400).end()
    }

    const transactionId = tx.id
    const status = tx.status
    const paymentLinkId = tx.payment_link_id || tx.payment_link
    const referencia = tx.reference

    console.log("📌 Webhook TX:")

    if (!paymentLinkId) {
      console.warn("⚠ TX sin payment_link_id, no se puede asociar a pagos")
      return res.status(200).json({ ok: false })
    }

    // 1️⃣ Buscar pago por payment_link_id
    const { data: pagos, error: pagosErr } = await supabase
      .from("pagos")
      .select("*")
      .eq("payment_link_id", paymentLinkId)
      .limit(1)

    if (pagosErr) {
      console.error("❌ Error buscando pago:")
      return res.status(500).json({ error: "Error buscando pago" })
    }

    if (!pagos || pagos.length === 0) {
      console.warn("⚠ No se encontró pago con payment_link_id:")
      return res.status(200).json({ ok: false })
    }

    const pago = pagos[0]
    const id_pedido = pago.id_pedido

    console.log("🧾 Pago encontrado en BD:")

    // 2️⃣ Actualizar registro de pagos
    await supabase
      .from("pagos")
      .update({
        status,
        transaction_id: transactionId,
        raw: tx
      })
      .eq("id_pago", pago.id_pago)

    // 3️⃣ Si la TX está aprobada, marcar pedido(s) como pagado
    if (String(status).toUpperCase() === "APPROVED") {
      // 👇 NUEVO: Obtener el id_cliente del pedido
      const { data: pedidoData, error: pedidoFetchErr } = await supabase
        .from("pedidos")
        .select("id_cliente")
        .eq("id_pedido", id_pedido)
        .single()

      if (pedidoFetchErr) {
        console.error("❌ Error obteniendo pedido:")
        return res.status(500).json({ error: "Error obteniendo pedido" })
      }

      const id_cliente = pedidoData?.id_cliente

      if (!id_cliente) {
        console.error("❌ No se encontró id_cliente para el pedido:")
        return res.status(500).json({ error: "No se encontró cliente" })
      }

      // 👇 NUEVO: Actualizar TODOS los pedidos no pagados del cliente
      const { error: pedidoErr, count } = await supabase
        .from("pedidos")
        .update({ pago: "pagado" })
        .eq("id_cliente", id_cliente)
        .eq("pago", "no_pagado")

      if (pedidoErr) {
        console.error("❌ Error actualizando pedidos:")
      } else {
        console.log("[wompi.controller.js] log")
      }
    }

    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error("❌ Error en webhook:")
    return res.status(500).json({ error: "Webhook processing error" })
  }
}
