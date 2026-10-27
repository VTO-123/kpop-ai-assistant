FROM node:20-alpine

WORKDIR /app

# 只装生产依赖（本项目只有 ogl 一个包）
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 应用代码（public / src / data / server.js）
COPY . .

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4321

EXPOSE 4321

# 数据目录（账号/收藏等）给 node 用户写权限；生产环境建议挂持久卷到 /app/data
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/config" >/dev/null || exit 1

CMD ["npm", "start"]
