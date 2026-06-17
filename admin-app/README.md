# Admin Prospects — app Android (Expo)

App de administración para ver todos los clientes de la Plataforma (y Etiguel,
Fase 4) con sus estadísticas, y recibir push cuando un cliente responde por
primera vez (Fase 3).

## Requisitos
- Node 18+ en la Mac (`brew install node`).
- App **Expo Go** en el celular Android (Play Store).
- El backend de la Plataforma corriendo (`docker compose up` en `../`).

## Configurar la IP del backend
El celular no puede usar `localhost`. Editar `app.json` → `expo.extra.apiUrl`
con la IP de tu Mac en la red local:

```bash
ipconfig getifaddr en0   # te da algo como 192.168.1.42
```

```json
"extra": { "apiUrl": "http://192.168.1.42:8000" }
```

## Correr
```bash
npm install
npx expo start
```
Escaneá el QR con Expo Go (Mac y celular en la misma Wi-Fi).

## Login
Usuario con rol `superadmin` en la Plataforma. En la base demo:
`sebi@demo.com` / `demo1234` (ya promovido a superadmin).

## Estructura
- `src/api.ts` — cliente HTTP + tipos (espejo de los schemas del backend).
- `src/auth.tsx` — login + token guardado en SecureStore.
- `src/screens/` — Login, Clientes (lista + overview), Detalle cliente (stats).
- `src/config.ts` — de dónde sale `API_URL`.

## Estado
- ✅ Fase 2: login, lista de clientes con KPIs, detalle con stats completas.
- ⏳ Fase 3: push notifications (primera respuesta).
- ⏳ Fase 4: Etiguel como fuente (adapter Monday).
