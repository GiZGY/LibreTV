FROM node:22-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --chown=node:node src ./src

EXPOSE 9979
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const headers={Authorization:'Bearer '+(process.env.TVBOX_BRIDGE_TOKEN||'')};fetch('http://127.0.0.1:9979/api/tvbox/health',{headers}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

USER node
CMD ["node", "src/server.mjs"]
