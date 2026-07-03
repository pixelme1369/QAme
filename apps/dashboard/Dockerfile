# Build from the monorepo root:
#   docker build -f apps/dashboard/Dockerfile -t dashboard \
#     --build-arg VITE_GOOGLE_OAUTH_CLIENT_ID=... .
FROM node:20-slim AS build
ARG VITE_GOOGLE_OAUTH_CLIENT_ID
ENV VITE_GOOGLE_OAUTH_CLIENT_ID=$VITE_GOOGLE_OAUTH_CLIENT_ID
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/scorecard-schema/package.json packages/scorecard-schema/
COPY apps/dashboard/package.json apps/dashboard/
RUN npm ci --workspace @qame/dashboard --include-workspace-root
COPY tsconfig.base.json ./
COPY packages/scorecard-schema packages/scorecard-schema
COPY apps/dashboard apps/dashboard
RUN npm run build -w @qame/scorecard-schema && npm run build -w @qame/dashboard

FROM nginx:1.27-alpine
COPY apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/dashboard/dist /usr/share/nginx/html
