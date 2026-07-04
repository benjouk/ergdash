# Self-Hosted Docker App

The existing single-user Docker app now lives in `apps/docker`.

## Docker Deploy

```bash
cd apps/docker
cp .env.example .env
docker-compose up -d --build
```

The app listens on `http://localhost:3100`.

## Development

From the repository root:

```bash
npm install
npm run dev:docker:server
npm run dev:docker:client
```

Or run the package scripts directly:

```bash
cd apps/docker/server
npm run seed
npm run dev

cd ../client
npm run dev
```

The Docker app remains the working self-hosted reference, but the main product direction is ErgDash Cloud.
