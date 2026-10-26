# Stage 1: Build the Vite application
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

# Build the application
RUN npm run build

# Stage 2: Serve the built application
FROM httpd:2.4-alpine

# Copy built files from builder stage
COPY --from=builder /app/dist/ /usr/local/apache2/htdocs/

# Expose port 80
EXPOSE 80
