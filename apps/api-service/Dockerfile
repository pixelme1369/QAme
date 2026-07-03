# Build from the monorepo root:
#   docker build -f apps/api-service/Dockerfile -t api-service .
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/scorecard-schema/package.json packages/scorecard-schema/
COPY packages/db/package.json packages/db/
COPY apps/api-service/package.json apps/api-service/
RUN npm ci --workspace @qame/api-service --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/scorecard-schema packages/scorecard-schema
COPY packages/db packages/db
COPY apps/api-service apps/api-service
RUN npm run build -w @qame/scorecard-schema \
 && npm run build -w @qame/db \
 && npm run build -w @qame/api-service

FROM node:20-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/api-service ./apps/api-service
USER node
CMD ["node", "apps/api-service/dist/index.js"]
