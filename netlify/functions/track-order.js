// File: netlify/functions/track-order.js
exports.handler = async (event) => {
  const API_TOKEN = process.env.DELHIVERY_API_TOKEN;
  const IS_STAGING = process.env.DELHIVERY_ENV === "staging";

  if (!API_TOKEN) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: "DELHIVERY_API_TOKEN not configured on server." })
    };
  }

  const params = event.queryStringParameters || {};
  const awb = String(params.awb || "").trim();
  const action = params.action || "track";

  if (!awb) {
    return { statusCode: 400, body: JSON.stringify({ success: false, error: "AWB number is required." }) };
  }

  const baseUrl = IS_STAGING
    ? "https://staging-express.delhivery.com"
    : "https://track.delhivery.com";

  try {
    if (action === "label") {
      const labelRes = await fetch(`${baseUrl}/api/p/packing_slip?wbns=${encodeURIComponent(awb)}&pdf=true`, {
        headers: { Authorization: `Token ${API_TOKEN}`, Accept: "application/json" }
      });
      const labelData = await labelRes.json();
      const pdfLink = labelData?.packages?.[0]?.pdf_download_link || null;
      return {
        statusCode: 200,
        body: JSON.stringify({ success: true, pdfLink })
      };
    }

    const trackRes = await fetch(`${baseUrl}/api/v1/packages/json/?waybill=${encodeURIComponent(awb)}`, {
      headers: { Authorization: `Token ${API_TOKEN}`, Accept: "application/json" }
    });

    const trackData = await trackRes.json();
    const shipment = trackData?.ShipmentData?.[0]?.Shipment;

    if (!shipment) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          success: false,
          error: "No live tracking record found yet for this AWB. Delhivery updates scans shortly after pickup."
        })
      };
    }

    const rawStatus = shipment.Status?.Status || "In Transit";
    const statusType = shipment.Status?.StatusType || "";

    let normalizedStatus = rawStatus;
    if (statusType === "UD" && rawStatus.toLowerCase().includes("manifest")) {
      normalizedStatus = "Pickup Pending";
    } else if (rawStatus.toLowerCase().includes("picked")) {
      normalizedStatus = "Picked Up";
    } else if (rawStatus.toLowerCase().includes("dispatched") || rawStatus.toLowerCase().includes("out for delivery")) {
      normalizedStatus = "Out for Delivery";
    } else if (statusType === "DL" || rawStatus.toLowerCase().includes("delivered")) {
      normalizedStatus = "Delivered";
    } else if (statusType === "RT" || rawStatus.toLowerCase().includes("rto")) {
      normalizedStatus = "Returned";
    } else if (rawStatus.toLowerCase().includes("transit") || statusType === "IT") {
      normalizedStatus = "In Transit";
    }

    const scans = (shipment.Scans || []).map((s) => ({
      status: s.ScanDetail?.Scan || rawStatus,
      location: s.ScanDetail?.ScannedLocation || "",
      time: s.ScanDetail?.ScanDateTime || "",
      instructions: s.ScanDetail?.Instructions || ""
    })).reverse();

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        awb,
        orderNumber: shipment.ReferenceNo || "",
        status: normalizedStatus,
        rawStatus,
        location: shipment.Status?.StatusLocation || "",
        updatedAt: shipment.Status?.StatusDateTime || new Date().toISOString(),
        instructions: shipment.Status?.Instructions || "",
        scans
      })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: err.message || "Failed to fetch Delhivery tracking." })
    };
  }
};
