import express from "express";

export function startHealthServer() {
  const app = express();
  const port = process.env.PORT || 3000;

  app.get("/health", (_req, res) => res.send("ok"));

  app.listen(port, () => {
    console.log(`HTTP server listening on ${port}`);
  });
}
