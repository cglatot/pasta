# Stage 1: Build the Vite application and typecheck client + server
FROM --platform=$BUILDPLATFORM node:24-alpine AS builder

WORKDIR /app

# Accept optional build argument for version injection
ARG VITE_APP_VERSION
ENV VITE_APP_VERSION=$VITE_APP_VERSION

# Copy package files
COPY package*.json ./

# Install dependencies cleanly
RUN npm ci

# Copy source code
COPY . .

# Typecheck and build the frontend static bundle
RUN npm run build

# Stage 2: Node.js 24 LTS runtime
FROM node:24-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=80
ENV PASTA_MODE=server
ENV PASTA_CONFIG_DIR=/config
ENV PASTA_DIST_DIR=/app/dist

# Ensure persistent /config volume directory exists
RUN mkdir -p /config

# Copy built frontend static assets and server sources
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/shared ./src/shared
COPY --from=builder /app/server/src ./server/src
COPY --from=builder /app/package.json ./package.json

EXPOSE 80

CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/index.ts"]
