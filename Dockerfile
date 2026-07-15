FROM node:22-alpine AS frontend-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/index.html client/vite.config.js ./
COPY client/public ./public
COPY client/src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app

LABEL org.opencontainers.image.source="https://github.com/benjouk/ergdash" \
      org.opencontainers.image.description="Self-hosted dashboard for Concept2 RowErg training analytics" \
      org.opencontainers.image.licenses="MIT"

RUN apk add --no-cache --virtual .build-deps python3 make g++
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && apk del .build-deps && apk add --no-cache su-exec

COPY server/server.js ./server.js
COPY server/src ./src
COPY server/migrations ./migrations
COPY --from=frontend-build /app/client/dist ./dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN mkdir -p /data && chmod 0755 /usr/local/bin/docker-entrypoint.sh
VOLUME /data

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV PORT=3000

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
