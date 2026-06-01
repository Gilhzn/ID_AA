#!/bin/sh
set -e

# Seed a demo agency on first boot so the dashboard isn't empty online.
if [ -z "$(ls -A /data/*.json 2>/dev/null || true)" ]; then
  echo "Seeding demo workspace into /data ..."
  node core/src/operator-cli.mjs import /data/Demo.json core/samples/invoices.csv \
    --name="Studio Pixel (Demo)" --signer="רותם לוי" --reply="billing@pixel.co.il" || true
fi

echo "Starting InvoiceChaser dashboard on port ${PORT:-3000} ..."
exec node core/src/server.mjs /data --port="${PORT:-3000}"
