# ForgeSite

ForgeSite turns a text prompt into a responsive React component, previews it with Sandpack, keeps recent builds in browser localStorage, and exports the selected component as a ZIP archive.

## Run on Replit

- Set the `GEMINI_API_KEY` secret in Replit Secrets. Keep this key server-side; do not add it to client-side environment variables.
- The workspace uses pnpm. Run `pnpm install`, then `pnpm run typecheck` and `pnpm run build`.
- Run the Replit `Project` workflow, which starts the configured workspace services.
- The API server uses `PORT` supplied by Replit. The Vite frontend also requires `BASE_PATH` and `PORT`, which are configured by the Replit workflow/environment.

## Key files

- `artifacts/forgesite/src/pages/forge-workbench.tsx` — prompt UI, Sandpack preview, local history, ZIP export.
- `artifacts/api-server/src/routes/forge.ts` — server-side Gemini generation endpoint.
- `lib/api-spec/openapi.yaml` — API contract used to generate client hooks and validation schemas.

## Notes

- Gemini model: `gemini-2.0-flash`.
- Generated websites are single React components styled with Tailwind CSS. Sandpack loads Tailwind from its CDN for preview.
- Build history is stored locally in the current browser and is not synced between devices.
