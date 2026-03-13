FROM node:20-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci

COPY . .

# Allow REACT_APP_* vars to be baked into the JS bundle at build time.
# Pass them via docker-compose build.args or --build-arg.
ARG REACT_APP_API_URL
ARG REACT_APP_SOCKET_URL
ENV REACT_APP_API_URL=$REACT_APP_API_URL
ENV REACT_APP_SOCKET_URL=$REACT_APP_SOCKET_URL

RUN npm run build

# Production image: serve with nginx
FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
