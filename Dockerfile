FROM node:20-alpine
WORKDIR /app

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --only=production

# Copy TypeScript built output and web UI
COPY dist/ ./dist/
COPY public/ ./public/

ENV NODE_ENV=production
ENV STORAGE_TYPE=firestore

EXPOSE 8081

CMD ["node", "dist/blog/server.js"]
