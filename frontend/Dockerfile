# ---- build ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- serve (non-root nginx, listens on 8080) ----
FROM nginxinc/nginx-unprivileged:stable-alpine-slim
ENV BACKEND_URL=http://backend:3000

# apply the latest Alpine security patches (needs root)
USER root
RUN apk upgrade --no-cache
USER nginx

# *.template files are rendered with env vars at container start
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
