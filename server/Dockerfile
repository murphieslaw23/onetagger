FROM node:22.23.3-alpine AS build
WORKDIR /app

RUN npm install --global pnpm@11.25.0

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY server/package.json ./server/package.json
COPY packages/domain/package.json ./packages/domain/package.json
RUN pnpm install --frozen-lockfile --filter @syco23/mixsets-server...

COPY server ./server
COPY packages/domain ./packages/domain
RUN pnpm --dir packages/domain build && pnpm --dir server build && pnpm --filter @syco23/mixsets-server deploy --prod --legacy /runtime

FROM node:22.23.3-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache ffmpeg

ENV NODE_ENV=production
ENV PORT=8787

COPY --from=build --chown=node:node /runtime ./

RUN mkdir -p /app/data && chown node:node /app/data

USER node
EXPOSE 8787

CMD ["node", "dist/index.js"]
