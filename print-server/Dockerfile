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

# Default port — can be overridden at runtime via the PORT environment variable
# (set it in .env or in the docker-compose environment section).
# NOTE: EXPOSE is informational only and always reflects the default port (3001).
# When using a custom PORT value the port is still published correctly through
# the docker-compose `ports` mapping; `docker run -p` users must map manually.
ENV PORT=3001

# Use the built-in non-root user provided by the official Node image.
# NOTE: if you use a `type: 'file'` printer (e.g. /dev/usb/lp0) the container
# must be able to write to that device. USB device files are typically owned by
# root:lp (mode 660). Options: add `group_add: ["lp"]` in docker-compose.yml
# (preferred) or run as root with `user: root`.
USER node

EXPOSE 3001

CMD ["node", "-r", "dotenv/config", "server.js"]
