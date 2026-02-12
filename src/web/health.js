import express from "express";

export function startHealthServer() {
  const app = express();
  const port = process.env.PORT || 3000;

  app.get("/health", (_req, res) => res.send("ok"));

  // CSV template download
  app.get("/wtb_template.csv", (_req, res) => {
    const template = `SKU,Size,Min Price,Max Price
DD1391-100,42,180,220
FQ8138-002,44.5,210,260
`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="wtb_template.csv"');
    res.send(template);
  });

  app.listen(port, () => console.log(`HTTP server listening on ${port}`));
}
