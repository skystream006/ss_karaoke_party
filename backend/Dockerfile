FROM node:20-alpine

# Install ffmpeg for server-side audio processing (pitch shifting)
RUN apk add --no-cache ffmpeg

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

EXPOSE 5000

CMD ["node", "server.js"]
