# Stage 1: build the static frontend and the API.
FROM node:22-slim AS build
RUN corepack enable && corepack prepare pnpm@11.20.0 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY hfs-schemas/package.json hfs-schemas/
COPY hfs-api/package.json hfs-api/
COPY hfs-frontend/package.json hfs-frontend/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @hfs/schemas build \
 && pnpm --filter hfs-frontend build \
 && pnpm --filter hfs-api build

# Stage 2: runtime. Express serves the API and the exported frontend.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./
COPY --from=build /app/hfs-schemas/package.json ./hfs-schemas/
COPY --from=build /app/hfs-schemas/node_modules ./hfs-schemas/node_modules
COPY --from=build /app/hfs-schemas/dist ./hfs-schemas/dist
COPY --from=build /app/hfs-api/package.json ./hfs-api/
COPY --from=build /app/hfs-api/node_modules ./hfs-api/node_modules
COPY --from=build /app/hfs-api/dist ./hfs-api/dist
COPY --from=build /app/hfs-api/assets ./hfs-api/assets
COPY --from=build /app/hfs-frontend/out ./hfs-frontend/out
COPY bibles ./bibles
EXPOSE 8080
CMD ["node", "hfs-api/dist/server.js"]
