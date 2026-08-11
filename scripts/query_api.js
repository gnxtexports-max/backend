import http from "http";

async function queryAPI() {
  console.log("Logging in to local API server http://localhost:5000 ...");

  // 1. Login
  const loginBody = JSON.stringify({
    username: "admin",
    password: "gnxt@admin@123"
  });

  const loginReq = http.request(
    {
      hostname: "localhost",
      port: 5000,
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
      console.log("Set-Cookie:", cookie);

      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        console.log("Login response body:", data);

        const cookieHeader = cookie ? cookie.map(c => c.split(";")[0]).join("; ") : "";

        // 2. Fetch shipments default query
        fetchShipments(cookieHeader, "");
        // 3. Fetch shipments with high limit
        fetchShipments(cookieHeader, "?limit=1000");
      });
    }
  );

  loginReq.on("error", (err) => {
    console.error("Login request error:", err);
  });
  loginReq.write(loginBody);
  loginReq.end();
}

function fetchShipments(cookieHeader, queryString) {
  const req = http.request(
    {
      hostname: "localhost",
      port: 5000,
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
          console.log(`\n================ GET /api/shipments${queryString} ================`);
          console.log("Response success:", json.success);
          console.log("Pagination returned:", json.pagination);
          if (Array.isArray(json.data)) {
            console.log("Total records returned in data array:", json.data.length);
            
            // Check status breakdown in returned array
            const counts = {};
            json.data.forEach((s) => {
              counts[s.status] = (counts[s.status] || 0) + 1;
            });
            console.log("Status distribution of returned records:", counts);

            // Check date breakdown: before vs after Aug 8, 2026
            const cutoff = new Date("2026-08-08T00:00:00.000Z");
            let beforeAug8 = 0;
            let afterAug8 = 0;
            json.data.forEach((s) => {
              const d = s.createdAt || s.deliveryDate || s.dispatchDate;
              if (d && new Date(d) < cutoff) {
                beforeAug8++;
              } else if (d) {
                afterAug8++;
              }
            });
            console.log("Records with date BEFORE Aug 8, 2026:", beforeAug8);
            console.log("Records with date ON/AFTER Aug 8, 2026:", afterAug8);

            // Print list of shipments
            console.log("\nShipment Summary List:");
            json.data.forEach((s, idx) => {
              console.log(`${idx + 1}. ID: ${s.shipmentId || s._id} | Status: ${s.status} | CreatedAt: ${s.createdAt} | DeliveryDate: ${s.deliveryDate} | Vehicle: ${s.vehicleNumber}`);
            });
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

queryAPI();
