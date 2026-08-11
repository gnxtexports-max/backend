import dns from "dns";
import mongoose from "mongoose";

dns.setServers(["8.8.8.8", "8.8.4.4", "1.1.1.1"]);

console.log("Resolving SRV records for _mongodb._tcp.cluster0.zkzxzxo.mongodb.net...");
dns.resolveSrv("_mongodb._tcp.cluster0.zkzxzxo.mongodb.net", (err, addresses) => {
  if (err) {
    console.error("DNS SRV resolution failed:", err);
  } else {
    console.log("SRV Addresses resolved:", addresses);
  }
});

const uri = "mongodb+srv://gnxt_admin:gnxt%40123@cluster0.zkzxzxo.mongodb.net/gnxt?retryWrites=true&w=majority&appName=Cluster0";

mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 })
  .then(() => {
    console.log("SUCCESS! Connected to MongoDB Atlas!");
    return mongoose.connection.db.collection("shipments").countDocuments({});
  })
  .then((count) => {
    console.log("Shipments count:", count);
    process.exit(0);
  })
  .catch((err) => {
    console.error("Connection failed:", err.message);
    process.exit(1);
  });
