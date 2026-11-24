exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const {
      customerName,
      customerPhone,
      streetAddress,
      city,
      state,
      pinCode,
      productId,
      productName,
      quantity,
      unitBuyingPrice,
      unitSellingPrice,
      deliveryCharge,
      paymentMode
    } = body;

    const cleanPhone = String(customerPhone || "").replace(/\D/g, "").slice(-10);
    const cleanPin = String(pinCode || "").replace(/\D/g, "");
    const qty = Math.max(1, parseInt(quantity, 10) || 1);

    if (!customerName || customerName.trim().length < 2) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Valid customer name is required." }) };
    }
    if (cleanPhone.length !== 10) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Enter a valid 10-digit mobile number." }) };
    }
    if (!streetAddress || !city || !state || cleanPin.length !== 6) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Complete address with a 6-digit PIN code is required." }) };
    }
    if (!productName) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Product details are missing." }) };
    }

    const delhiveryToken = process.env.DELHIVERY_API_TOKEN;
    const pickupLocation = process.env.DELHIVERY_PICKUP_LOCATION;
    const isStaging = (process.env.DELHIVERY_ENV || "production").toLowerCase() === "staging";

    if (!delhiveryToken || !pickupLocation) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: "Server shipping keys missing in Netlify." })
      };
    }

    const orderNumber = `KIV-${Date.now().toString().slice(-6)}`;
    const sellAmt = (Number(unitSellingPrice) || 0) * qty;
    const buyAmt = (Number(unitBuyingPrice) || 0) * qty;
    const delCollected = Number(deliveryCharge) || 0;
    const totalAmount = sellAmt + delCollected;
    const payMode = paymentMode === "COD" ? "COD" : "Prepaid";

    const delhiveryEndpoint = isStaging
      ? "https://staging-express.delhivery.com/api/cmu/create.json"
      : "https://track.delhivery.com/api/cmu/create.json";

    const shipmentManifest = {
      shipments: [
        {
          name: customerName.trim(),
          add: `${streetAddress.trim()}, ${city.trim()}, ${state.trim()}`,
          pin: cleanPin,
          city: city.trim(),
          state: state.trim(),
          country: "India",
          phone: cleanPhone,
          order: orderNumber,
          payment_mode: payMode,
          return_pin: "",
          return_city: "",
          return_phone: "",
          return_add: "",
          return_state: "",
          return_country: "India",
          products_desc: `${productName.trim()} (x${qty})`,
          hsn_code: "",
          cod_amount: payMode === "COD" ? String(totalAmount) : "0",
          order_date: new Date().toISOString().slice(0, 10),
          total_amount: String(totalAmount),
          seller_add: "",
          seller_name: "KIVORA",
          seller_inv: orderNumber,
          quantity: String(qty),
          waybill: "",
          shipment_width: "15",
          shipment_height: "10",
          weight: String(250 * qty),
          seller_gst_tin: "",
          shipping_mode: "Surface",
          address_type: "home"
        }
      ],
      pickup_location: {
        name: pickupLocation.trim()
      }
    };

    const formBody = `format=json&data=${encodeURIComponent(JSON.stringify(shipmentManifest))}`;

    const delhiveryRes = await fetch(delhiveryEndpoint, {
      method: "POST",
      headers: {
        "Authorization": `Token ${delhiveryToken}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body: formBody
    });

    const delhiveryData = await delhiveryRes.json();

    if (!delhiveryRes.ok || delhiveryData.success === false) {
      const errDetail = delhiveryData?.packages?.[0]?.remarks?.[0] || delhiveryData?.rmk || "Delhivery rejected the shipment.";
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: `Delhivery Error: ${errDetail}` })
      };
    }

    const awbNumber = delhiveryData?.packages?.[0]?.waybill || "";

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        order: {
          orderNumber,
          customerName: customerName.trim(),
          customerPhone: cleanPhone,
          deliveryAddress: `${streetAddress.trim()}, ${city.trim()}, ${state.trim()} - ${cleanPin}`,
          pinCode: cleanPin,
          city: city.trim(),
          state: state.trim(),
          productId: productId || "",
          productName: productName.trim(),
          quantity: qty,
          buyingAmount: buyAmt,
          sellingAmount: sellAmt,
          deliveryCollected: delCollected,
          actualCourierCharge: 0,
          packagingCost: 0,
          courierPartner: "Delhivery",
          awbNumber,
          paymentMode: payMode,
          paymentStatus: payMode === "Prepaid" ? "Paid" : "Pending",
          orderStatus: awbNumber ? "Processing" : "Pending",
          createdAtMs: Date.now()
        }
      })
    };
  } catch (err) {
    console.error("place-order function error:", err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: "Internal server error while creating shipment." })
    };
  }
};
