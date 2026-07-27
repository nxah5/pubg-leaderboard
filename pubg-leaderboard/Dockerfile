FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0

COPY package*.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY public ./public

EXPOSE 4177

CMD ["node", "server.js"]
