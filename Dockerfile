FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev
FROM node:22-alpine
RUN apk add --no-cache postgresql16-client
ENV NODE_ENV=production PORT=9090 HOST=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared
COPY --chown=node:node docs ./docs
COPY --chown=node:node vendor ./vendor
RUN mkdir -p /var/lib/project-studio/backups && chown -R node:node /var/lib/project-studio
USER node
EXPOSE 9090
HEALTHCHECK --interval=20s --timeout=5s --start-period=60s CMD node -e "fetch('http://127.0.0.1:9090/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node_modules/.bin/tsx","server/index.ts"]

