import express from "express";
import cors from "cors";
import { createPool } from "@qame/db";
import { loadConfig } from "./config.js";
import { authenticate } from "./auth.js";
import { errorMiddleware } from "./lib/http.js";
import { callsRouter } from "./routes/calls.js";
import { analyticsRouter } from "./routes/analytics.js";
import { scorecardsRouter } from "./routes/scorecards.js";
import { opsRouter, coachingRouter } from "./routes/ops.js";
import { orgRouter } from "./routes/org.js";

const config = loadConfig();
const db = createPool();

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cors({ origin: config.DASHBOARD_ORIGIN }));

app.get("/healthz", (_req, res) => {
  res.json({ ok: true });
});

// Everything under /api requires an authenticated, provisioned user.
const api = express.Router();
api.use(authenticate(db, config));
api.use("/", orgRouter(db));
api.use("/calls", callsRouter(db));
api.use("/analytics", analyticsRouter(db));
api.use("/scorecards", scorecardsRouter(db));
api.use("/coaching-notes", coachingRouter(db));
api.use("/ops", opsRouter(db));
app.use("/api", api);

app.use(errorMiddleware);

app.listen(config.PORT, () => {
  console.log(
    JSON.stringify({ severity: "INFO", message: "api-service listening", port: config.PORT }),
  );
});
