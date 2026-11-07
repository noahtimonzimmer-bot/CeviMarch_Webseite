FROM node:22-bookworm-slim

ENV NODE_ENV=production
ENV DATA_DIR=/daten

WORKDIR /app

# Abhaengigkeiten zuerst, damit Docker den Schritt zwischenspeichern kann.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public

RUN mkdir -p /daten && chown -R node:node /daten /app
USER node

EXPOSE 3000
VOLUME ["/daten"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/api/ich').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
