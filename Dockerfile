FROM node:24.22.1-bookworm-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/.data
WORKDIR /app
RUN chown node:node /app
USER node
COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --chown=node:node server.js online-rules.js ui-actions.js index.html style.css ./
COPY --chown=node:node pilgrim-progress/ ./pilgrim-progress/
COPY --chown=node:node seventy-disciples/ ./seventy-disciples/
RUN mkdir -p /app/.data
EXPOSE 3000
CMD ["node", "server.js"]
