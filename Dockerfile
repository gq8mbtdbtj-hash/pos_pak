# Personal OS (pure-web) — one image: builds the frontend + the Go server and
# serves both on :8787. Data persists in the /data volume.
#
#   docker compose up -d      # 一条命令跑起来（推荐）
# 或
#   docker build -t personal-os-web .
#   docker run -d -p 8787:8787 -v personal-os-data:/data personal-os-web

# 1) Frontend (Vite). .npmrc in the repo already points npm at a China mirror.
FROM node:22-slim AS web
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

# 2) Go server (pure Go, static). goproxy.cn keeps module downloads fast in China.
FROM golang:1.22-alpine AS server
ENV CGO_ENABLED=0 GOPROXY=https://goproxy.cn,direct
WORKDIR /src/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN go build -trimpath -ldflags "-s -w" -o /out/personal-os-server ./cmd/server

# 3) Tiny runtime image (ca-certificates for HTTPS sync; tzdata for pay-period dates).
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
WORKDIR /app
COPY --from=server /out/personal-os-server ./personal-os-server
COPY --from=web /app/dist ./dist
ENV POS_ADDR=0.0.0.0:8787 \
    POS_DATA_DIR=/data \
    POS_DIST_DIR=/app/dist \
    TZ=Asia/Shanghai
VOLUME ["/data"]
EXPOSE 8787
ENTRYPOINT ["/app/personal-os-server"]
