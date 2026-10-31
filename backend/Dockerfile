FROM node:26.12.1-alpine3.23@sha256:bc2b334006f15c7167bbeb2f08f28c2df883f7594a0470e04454ebe7560cfe68 AS builder

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
# Pruning uses the dependencies fetched above; it must not require another
# registry round trip or install other workspaces while removing build tools.
RUN --network=none npm prune --workspace=backend --include-workspace-root=false \
    --omit=dev --omit=optional --offline --ignore-scripts --no-audit --no-fund


FROM node:26.12.1-alpine3.23@sha256:bc2b334006f15c7167bbeb2f08f28c2df883f7594a0470e04454ebe7560cfe68 AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/backend/dist ./dist
COPY --from=builder /app/backend/package.json ./package.json

# The server starts with node directly. Exclude the base image's bundled npm
# toolchain from the runtime image; it is unused there and adds vulnerable
# transitive packages that are not part of the application dependency tree.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Run with no root privileges and no writable application source directory.
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001 -G nodejs
USER nodejs

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/live || exit 1

CMD ["node", "dist/bootstrap.js"]
