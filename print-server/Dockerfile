# Pin the Node.js version once — shared by both stages.
# Must satisfy the engines.node constraint in package.json (>=20.19.0).
ARG NODE_VERSION=20.19.0

# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine AS deps

WORKDIR /app

# Install production dependencies only
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION}-alpine

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
