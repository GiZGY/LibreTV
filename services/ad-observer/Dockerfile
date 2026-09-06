FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir /data && chown node:node /data && chmod 700 /data
COPY services/ad-observer ./services/ad-observer
COPY scripts/audit-hls-ads.mjs scripts/audit-source-ads.mjs ./scripts/
COPY js/config.js js/customer_site.js js/ad-rules.js js/ad-guard.js ./js/
COPY bridge/tvbox-bridge/src ./bridge/tvbox-bridge/src
USER node
CMD ["node", "services/ad-observer/worker.mjs", "watch", "--data", "/data", "--interval-hours", "6"]
