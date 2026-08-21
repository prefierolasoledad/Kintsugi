import cors from "cors";
import express from "express";

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "kintsugi-backend" });
});

app.listen(PORT, () => {
  console.log(`Kintsugi backend listening on http://localhost:${PORT}`);
});
