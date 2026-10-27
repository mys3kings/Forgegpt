# Deploy ForgeSite Builder to Vercel

## What this setup does
- Builds the existing React + Vite frontend from `artifacts/forgesite`.
- Publishes the static output from `artifacts/forgesite/dist/public`.
- Runs website generation through Vercel serverless functions at `/api/forge/generate`.
- Keeps the Gemini API key on the server; do not put it in a `VITE_*` variable.

## GitHub and Vercel
1. Upload/push the contents of this project folder to a GitHub repository.
2. In Vercel, create a project and import that repository.
3. Keep the **Root Directory** set to `./` (the repository root).
4. Use the settings from `vercel.json`:
   - Install command: `pnpm install --frozen-lockfile`
   - Build command: `pnpm --filter @workspace/forgesite build`
   - Output directory: `artifacts/forgesite/dist/public`
5. In Vercel → Project → Settings → Environment Variables, add `GEMINI_API_KEY` with your Google Gemini API key. Apply it to the environments you will use (Production, and Preview if desired).
6. Deploy, then test the home page and `/api/healthz`. Test the website generation feature after adding the API key.

## Notes
- The Vercel project uses the repository root because the app imports workspace packages from `lib/`.
- `vercel.json` includes an SPA fallback for client-side routes.
- The Express server in `artifacts/api-server` remains in the repository for its existing non-Vercel workflow; Vercel uses the small serverless API handlers in `api/`.
- The Vite config no longer requires Replit-only `PORT` and `BASE_PATH` environment variables. `PORT` defaults to 5173 and `BASE_PATH` defaults to `/`.
- If the build fails, check that the repository's `pnpm-lock.yaml` is committed and that Vercel is using pnpm.
