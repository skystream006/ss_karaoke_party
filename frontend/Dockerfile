FROM node:24-alpine AS build

WORKDIR /app
COPY package*.json ./
COPY patches/ ./patches/
RUN npm ci

COPY . .
RUN npm run build

# Production image: serve with nginx
FROM nginx:alpine AS proxy
RUN apk add --no-cache nodejs openssl
COPY configure-https.cjs /opt/karaoke/configure-https.cjs
COPY nginx.conf /opt/karaoke/nginx.conf.template
COPY docker-entrypoint.d/15-configure-https.sh /docker-entrypoint.d/15-configure-https.sh
RUN chmod +x /docker-entrypoint.d/15-configure-https.sh
EXPOSE 80 443

FROM proxy
COPY --from=build /app/build /usr/share/nginx/html
CMD ["nginx", "-g", "daemon off;"]
