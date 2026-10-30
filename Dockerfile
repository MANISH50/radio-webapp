# syntax=docker/dockerfile:1
FROM node:22.22.0-bookworm-slim AS build
WORKDIR /app
COPY server/package.json server/package-lock.json server/.npmrc server/
COPY client/package.json client/package-lock.json client/.npmrc client/
RUN npm --prefix server ci && npm --prefix client ci
COPY server server
COPY client client
RUN npm --prefix client run build \
 && npm --prefix server run build \
 && npm --prefix server prune --omit=dev

FROM node:22.22.0-bookworm-slim
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/public
WORKDIR /app
# Files stay root-owned and read-only to the runtime user.
COPY --from=build /app/server/package.json ./package.json
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/client/dist ./public
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:8080/api/v1/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/index.js"]
