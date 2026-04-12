# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Copy installed dependencies from the build stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY server.js printer.js printers.config.js ./
COPY formatters/ ./formatters/

# Use the built-in non-root user provided by the official Node image
USER node

EXPOSE 3001

CMD ["node", "-r", "dotenv/config", "server.js"]
