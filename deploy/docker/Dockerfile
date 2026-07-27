FROM node:22-alpine

LABEL maintainer="OpenStream Team"
LABEL description="OpenStream - 免费在线视频搜索与观看平台"

ENV NODE_ENV=production
ENV PORT=8080
ENV DEBUG=false

WORKDIR /app

COPY package*.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build \
    && npm prune --omit=dev \
    && npm cache clean --force \
    && chown -R node:node /app

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) }).on('error', () => process.exit(1))"

USER node
CMD ["npm", "start"]
