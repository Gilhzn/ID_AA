# InvoiceChaser dashboard — Node server (zero runtime dependencies).
# Build context: the invoicechaser/ folder.
FROM node:22-alpine

WORKDIR /app

# Only the core (engine + zero-dep server) is needed at runtime.
COPY core ./core
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x ./docker-entrypoint.sh && mkdir -p /data

# Hosts (Render/Fly/etc.) inject PORT; default 3000 locally.
ENV PORT=3000
EXPOSE 3000

# Persist agency workspaces here (mount a volume for durability).
VOLUME ["/data"]

ENTRYPOINT ["./docker-entrypoint.sh"]
