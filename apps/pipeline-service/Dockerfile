# Build from the monorepo root:
#   docker build -f apps/pipeline-service/Dockerfile -t pipeline-service .
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/scorecard-schema/package.json packages/scorecard-schema/
COPY packages/db/package.json packages/db/
COPY apps/pipeline-service/package.json apps/pipeline-service/
RUN npm ci --workspace @qame/pipeline-service --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/scorecard-schema packages/scorecard-schema
COPY packages/db packages/db
COPY apps/pipeline-service apps/pipeline-service
RUN npm run build -w @qame/scorecard-schema \
 && npm run build -w @qame/db \
 && npm run build -w @qame/pipeline-service

FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/pipeline-service ./apps/pipeline-service
USER node
CMD ["node", "apps/pipeline-service/dist/index.js"]
