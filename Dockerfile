# ---------- Build Stage ----------
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install ALL dependencies (including dev for TypeScript)
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build


# ---------- Production Stage ----------
FROM node:20-alpine

# Install curl for health checks
RUN apk add --no-cache curl

WORKDIR /app

# Copy only production package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy built app from builder
COPY --from=builder /app/dist ./dist

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Start app
CMD ["node", "dist/server.js"]
