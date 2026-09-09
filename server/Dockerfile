# ─── STAGE 1: BUILDER ────────────────────────────────────────────────────────
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies needed for compiling native packages if any
RUN apk add --no-cache python3 make g++

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src/ ./src/
RUN npm run build

# ─── STAGE 2: PRODUCTION RUNNER ──────────────────────────────────────────────
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=4000
ENV HOST=0.0.0.0

# Install dumb-init for proper signal handling and PID 1 reaper
RUN apk add --no-cache dumb-init

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy built code and assets
COPY --from=builder /app/dist ./dist
COPY src/db/schema.sql ./src/db/schema.sql
COPY src/db/indexes.sql ./src/db/indexes.sql

# Non-root security
USER node

EXPOSE 4000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
