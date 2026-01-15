


import express from "express";
import { updatebilling } from "../../../controllers/billing/updatebilling";

const app = express();

// Middleware to parse JSON
app.use(express.json());

// Route
app.post("/api/wms/billing/updatebilling", updatebilling);

// Start server
app.listen(3000, () => {
  console.log("Server running on port 3000");
});
