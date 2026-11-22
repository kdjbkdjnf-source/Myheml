FROM node:22-alpine

WORKDIR /app

# 零第三方依赖：无需 npm install
COPY package.json ./
COPY server ./server
COPY public ./public

ENV NODE_ENV=production
ENV PORT=5173
EXPOSE 5173

# 数据目录（数据库与上传图片），建议挂载 volume
RUN mkdir -p /app/data /app/uploads

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:5173/api/plans >/dev/null || exit 1

CMD ["node", "--no-warnings", "server/index.js"]
