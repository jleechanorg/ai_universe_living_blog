FROM node:20-alpine
WORKDIR /app

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy TypeScript built output and web UI
COPY dist/ ./dist/
COPY public/ ./public/

ENV NODE_ENV=production
ENV STORAGE_TYPE=firestore
ENV PORT=8081

# Run as non-root node user
RUN addgroup -S appgroup && adduser -S nodeuser -G appgroup
COPY --chown=nodeuser:appgroup dist/ ./dist/
COPY --chown=nodeuser:appgroup public/ ./public/
# Pre-create data/ and logs/ so nodeuser can write at runtime
RUN mkdir -p /app/data /app/logs && chown -R nodeuser:appgroup /app/data /app/logs
USER nodeuser

EXPOSE 8081

CMD ["node", "dist/blog/server.js"]
