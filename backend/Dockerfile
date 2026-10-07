FROM node:24.21.0-alpine3.23@sha256:9ec4a2e289874ed0d722e1772ec2de45d2801541db8612f3638b26f128c69ac2 AS builder

WORKDIR /app

# Build from the repository root so npm can enforce the committed workspace
# lockfile. Invoke with: docker build -f backend/Dockerfile .
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
COPY tools/next-lint-glob ./tools/next-lint-glob
RUN npm ci --workspace=backend --include-workspace-root=false

COPY backend ./backend
RUN npm run build --workspace=backend
RUN npm prune --omit=dev --omit=optional


FROM node:24.21.0-alpine3.23@sha256:9ec4a2e289874ed0d722e1772ec2de45d2801541db8612f3638b26f128c69ac2 AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/package.json ./package.json

# Run with no root privileges and no writable application source directory.
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001 -G nodejs
USER nodejs

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/live || exit 1

CMD ["node", "dist/bootstrap.js"]
