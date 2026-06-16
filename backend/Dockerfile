FROM node:24-alpine AS builder

WORKDIR /app

# Copy only the backend's package files
COPY package*.json ./

# Install all dependencies (including devDependencies for building)
RUN npm install

# Copy the rest of the backend files
COPY . .

# Build the TypeScript code (assumes tsc is in package.json build script)
RUN npm run build

# Remove development dependencies for production
RUN npm prune --production


FROM node:24-alpine

WORKDIR /app

# Copy built files and production dependencies
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Set the environment and port
ENV NODE_ENV=production
ENV PORT=8080

# Run as non-root user for security (principle of least privilege)
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs

EXPOSE 8080

# DEV-01 fix: Healthcheck to ensure container is responsive
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:8080/health || exit 1

# Run the app
CMD ["node", "dist/server.js"]
