#!/usr/bin/env sh
# Assemble the static, browser-only InvoiceChaser dashboard into ./public.
# Used by Render (static site) and for local preview. Run from anywhere.
set -e
cd "$(dirname "$0")"                 # invoicechaser/web
rm -rf public
mkdir -p public/engine
cp index.html app.js public/
cp ../core/src/*.mjs public/engine/
echo "✓ static site built → invoicechaser/web/public ($(ls public/engine | wc -l) engine modules)"
