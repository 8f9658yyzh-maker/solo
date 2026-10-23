# ソロ サーバー(外部の部品は不要。Node 22 だけで動く)
FROM node:22-slim
WORKDIR /app
COPY engine.js ./engine.js
COPY server ./server
COPY web ./web
ENV PORT=8080 DB_FILE=/data/solo.db TRUST_PROXY=1
VOLUME /data
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
