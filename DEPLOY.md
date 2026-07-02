# Backend - Render Deployment Guide

## Deployed URL
`https://gnxt-backend.onrender.com`

---

## GitHub Repo
```
https://github.com/madhuragnxt/Gnxt-backend
```

---

## How to Push Updates

```powershell
cd D:\Gnxt-backend-main\backend
git add .
git commit -m "your message"
git push
```

Render auto-deploys from the `main` branch.

---

## Environment Variables (set in Render Dashboard)

| Variable | Value | Secret? |
|----------|-------|---------|
| `NODE_ENV` | `production` | No |
| `PORT` | `5000` | No |
| `MONGO_URI` | *(set in Render Dashboard — see `.env.example` for format)* | **Yes** |
| `JWT_SECRET` | `gnxt_super_secret_2026` | **Yes** |
| `JWT_EXPIRES` | `7d` | No |
| `CORS_ORIGIN` | `https://gnxt.vercel.app` | No |
| `SMTP_HOST` | `smtp.gmail.com` | No |
| `SMTP_PORT` | `465` | No |
| `SMTP_USER` | `divyamadhuratech@gmail.com` | **Yes** |
| `SMTP_PASS` | *(your app password)* | **Yes** |

---

## Render Free Tier - Important

- Backend **sleeps after 15 min of inactivity**
- First request after idle takes ~30-60s to wake up
- Frontend's `useKeepAlive.js` pings `/api/health` every 4 min to prevent sleeping
- Frontend `BackendHealthContext` pings every 30s and shows API status in header

---

## MongoDB Atlas - Network Access

Add these Render outbound IPs in Atlas:
```
74.220.48.0/24
74.220.56.0/24
216.151.17.91
216.151.17.92
```
Or just allow `0.0.0.0/0` (anywhere).

---

## Health Check Endpoint
```
GET /health
GET /api/health
```
Returns: `{ message: "Server is running", socketClients: 0 }`

---

## Files That Control Deployment
| File | Purpose |
|------|---------|
| `render.yaml` | Render blueprint config (CORS, env vars, start command) |
| `Procfile` | Tells Render to run `bash start.sh` |
| `start.sh` | Creates `uploads/` dir then starts server |
