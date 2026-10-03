FROM node:22-alpine AS build
WORKDIR /app

RUN npm install --global pnpm@11

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY server/package.json ./server/package.json
RUN pnpm install --frozen-lockfile --filter @syco23/mixsets-server...

COPY server ./server
RUN pnpm --dir server build

FROM node:22-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache ffmpeg

ENV NODE_ENV=production
ENV PORT=8787

COPY --from=build --chown=node:node /app/server/dist ./dist

USER node
EXPOSE 8787

CMD ["node", "dist/index.js"]
