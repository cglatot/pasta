# Stage 1: Build the Vite application
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --legacy-peer-deps

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Stage 2: Serve the built application
FROM httpd:2.4

# Copy built files from builder stage
COPY --from=builder /app/dist/ /usr/local/apache2/htdocs/

# Expose port 80
EXPOSE 80

