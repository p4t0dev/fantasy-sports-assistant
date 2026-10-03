# Frontend

Next.js (statischer Export nach `out/`, ausgeliefert über Firebase Hosting).
Aufbau, Setup, Deploy und das Prognose-Modell stehen in der
[Haupt-README](../README.md).

```bash
npm install
NEXT_PUBLIC_API_URL=http://127.0.0.1:5001/<project-id>/us-central1 npm run dev
```

Lokal über `localhost` oder `127.0.0.1` öffnen; andere Hosts blockt der
Dev-Server (`allowedDevOrigins` in `next.config.ts`).
