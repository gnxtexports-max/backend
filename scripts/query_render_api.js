import https from "https";

const BASE_HOST = "gnxt-backend.onrender.com";

async function queryRenderAPI() {
  console.log(`Connecting to live production API https://${BASE_HOST}/api ...`);

  // 1. Login to live production backend
  const loginBody = JSON.stringify({
    username: "admin",
    password: "gnxt@admin@123"
  });

  const loginReq = https.request(
    {
      hostname: BASE_HOST,
      path: "/api/auth/login",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(loginBody)
      }
    },
    (res) => {
      let data = "";
      const cookie = res.headers["set-cookie"];
      console.log("Login response status:", res.statusCode);
      console.log("Set-Cookie header:", cookie);

      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        console.log("Login response body:", data);

        const cookieHeader = cookie ? cookie.map(c => c.split(";")[0]).join("; ") : "";

        // Query default (no limit param)
        fetchShipments(cookieHeader, "", "DEFAULT QUERY (No limit parameter)");

        // Query with limit=1000
        fetchShipments(cookieHeader, "?limit=1000", "QUERY WITH limit=1000");
      });
    }
  );

  loginReq.on("error", (err) => {
    console.error("Login request error:", err);
  });
  loginReq.write(loginBody);
  loginReq.end();
}

function fetchShipments(cookieHeader, queryString, label) {
  const req = https.request(
    {
      hostname: BASE_HOST,
      path: `/api/shipments${queryString}`,
      method: "GET",
      headers: {
        Cookie: cookieHeader
      }
    },
    (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          console.log(`\n================ ${label}: GET /api/shipments${queryString} ================`);
          console.log("Success:", json.success);
          console.log("Pagination returned by backend:", json.pagination);
          if (Array.isArray(json.data)) {
            console.log("Number of shipment records in 'data' array:", json.data.length);

            // Status breakdown
            const counts = {};
            json.data.forEach((s) => {
              const st = s.status || "UNKNOWN";
              counts[st] = (counts[st] || 0) + 1;
            });
            console.log("Status distribution of returned records:", counts);

            // Date breakdown (August 8, 2026 cutoff)
            const cutoff = new Date("2026-08-08T00:00:00.000Z");
            let beforeAug8 = 0;
            let afterAug8 = 0;
            let noDate = 0;
            json.data.forEach((s) => {
              const d = s.createdAt || s.deliveryDate || s.dispatchDate;
              if (!d) {
                noDate++;
              } else if (new Date(d) < cutoff) {
                beforeAug8++;
              } else {
                afterAug8++;
              }
            });
            console.log("Records with date BEFORE Aug 8, 2026:", beforeAug8);
            console.log("Records with date ON/AFTER Aug 8, 2026:", afterAug8);
            console.log("Records with NO date field:", noDate);

            console.log("\nDetailed Records List:");
            json.data.forEach((s, idx) => {
              const d = s.createdAt || s.deliveryDate || s.dispatchDate;
              const dest0 = s.destinations?.[0] || {};
              console.log(`[${idx + 1}] ID: ${s.shipmentId || s._id} | Status: ${s.status} | Date: ${d} | Vehicle: ${s.vehicleNumber} | Customer: ${dest0.customerName}`);
            });
          } else {
            console.log("json.data is not an array:", json);
          }
        } catch (e) {
          console.error("Error parsing JSON:", e, data);
        }
      });
    }
  );
  req.on("error", (err) => {
    console.error("Fetch shipments error:", err);
  });
  req.end();
}

queryRenderAPI();
