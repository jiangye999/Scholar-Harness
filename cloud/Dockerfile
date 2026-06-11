FROM node:22-alpine AS builder

WORKDIR /app

COPY cloud/package*.json ./
RUN npm ci

COPY cloud/tsconfig.json ./
COPY cloud/database ./database
COPY cloud/server ./server
COPY cloud/storage ./storage
COPY cloud/auth ./auth
COPY cloud/payment ./payment
COPY cloud/cloud-storage ./cloud-storage
COPY cloud/public ./public
COPY src/utils ./src/utils
COPY src/types ./src/types

RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 scholar

COPY cloud/package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

RUN chown -R scholar:nodejs /app

USER scholar

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/server/index.js"]