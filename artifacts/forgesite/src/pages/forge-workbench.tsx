import { useEffect, useMemo, useState } from 'react';
import { SandpackCodeEditor, SandpackLayout, SandpackPreview, SandpackProvider } from '@codesandbox/sandpack-react';
import * as ForgeApi from '@workspace/api-client-react';
import {
  ArrowDownToLine, ArrowRight, Check, Clock3, Code2, Copy, Cpu, ExternalLink,
  FileCode2, Flame, History, LoaderCircle, Monitor, RotateCw, Sparkles, WandSparkles,
} from 'lucide-react';

type Generation = { id: string; prompt: string; code: string; createdAt: string };
type ForgeMutation = {
  isPending: boolean;
  mutate: (variables: { data: { prompt: string } }, options?: {
    onSuccess?: (result: { code: string }) => void;
    onError?: (error: unknown) => void;
  }) => void;
};
const useGenerateForgeSite = (ForgeApi as unknown as { useGenerateForgeSite: () => ForgeMutation }).useGenerateForgeSite;
const { useHealthCheck } = ForgeApi;
const STORAGE_KEY = 'forgesite-generations-v1';
const starterCode = `export default function App() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 grid place-items-center p-8">
      <div className="max-w-lg text-center">
        <div className="mx-auto mb-6 grid h-14 w-14 place-items-center rounded-2xl bg-indigo-600 text-white">
          <span className="text-xl font-semibold">F</span>
        </div>
        <p className="mb-3 text-xs font-semibold uppercase tracking-[.2em] text-indigo-600">Your canvas is ready</p>
        <h1 className="text-4xl font-semibold tracking-tight">A good idea starts here.</h1>
        <p className="mt-4 leading-7 text-slate-500">Describe the website you want to make. ForgeSite will turn your prompt into a responsive React component.</p>
      </div>
    </main>
  );
}`;

function readHistory(): Generation[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Generation =>
      !!item && typeof item.id === 'string' && typeof item.prompt === 'string' &&
      typeof item.code === 'string' && typeof item.createdAt === 'string',
    );
  } catch {
    return [];
  }
}

function formatDate(value: string) {
  const date = new Date(value);
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function packageDependencies(code: string): Record<string, string> {
  // Only external package imports belong in Sandpack/export dependencies.
  // Relative paths and app aliases (for example @/components/Button) are local files.
  const specifiers = [...code.matchAll(/\b(?:from\s*|import\s*\()\s*[\'"]([^\'"]+)[\'"]/g)]
    .map((match) => match[1]);
  const packages = specifiers.flatMap((specifier) => {
    if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('@/') || specifier.startsWith('~/')) return [];
    const parts = specifier.split('/');
    const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    if (!name || ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime'].includes(name) || name.startsWith('node:')) return [];
    return [name];
  });
  return Object.fromEntries([...new Set(packages)].map((name) => [name, 'latest']));
}

function crc32(data: Uint8Array) {
  let crc = -1;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (-(crc & 1) & 0xedb88320);
  }
  return (crc ^ -1) >>> 0;
}

function makeZip(files: { name: string; content: string }[]) {
  const encoder = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const write16 = (view: DataView, at: number, value: number) => view.setUint16(at, value, true);
  const write32 = (view: DataView, at: number, value: number) => view.setUint32(at, value, true);
  for (const file of files) {
    const name = encoder.encode(file.name);
    const data = encoder.encode(file.content);
    const crc = crc32(data);
    const header = new Uint8Array(30 + name.length);
    const view = new DataView(header.buffer);
    write32(view, 0, 0x04034b50); write16(view, 4, 20); write16(view, 6, 0x0800);
    write16(view, 8, 0); write32(view, 14, crc); write32(view, 18, data.length);
    write32(view, 22, data.length); write16(view, 26, name.length); header.set(name, 30);
    local.push(header, data);
    const directory = new Uint8Array(46 + name.length);
    const dv = new DataView(directory.buffer);
    write32(dv, 0, 0x02014b50); write16(dv, 4, 20); write16(dv, 6, 20);
    write16(dv, 8, 0x0800); write16(dv, 10, 0); write32(dv, 16, crc);
    write32(dv, 20, data.length); write32(dv, 24, data.length); write16(dv, 28, name.length);
    write32(dv, 42, offset); directory.set(name, 46);
    central.push(directory);
    offset += header.length + data.length;
  }
  const centralSize = central.reduce((size, part) => size + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  write32(endView, 0, 0x06054b50); write16(endView, 8, files.length);
  write16(endView, 10, files.length); write32(endView, 12, centralSize); write32(endView, 16, offset);
  const parts = [...local, ...central, end];
  const total = parts.reduce((size, part) => size + part.length, 0);
  const bytes = new Uint8Array(total);
  let cursor = 0;
  parts.forEach((part) => { bytes.set(part, cursor); cursor += part.length; });
  return new Blob([bytes.buffer as ArrayBuffer], { type: 'application/zip' });
}

export default function ForgeWorkbench() {
  const [history, setHistory] = useState<Generation[]>([]);
  const [selected, setSelected] = useState<Generation | null>(null);
  const [prompt, setPrompt] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const [generationError, setGenerationError] = useState('');
  const generation = useGenerateForgeSite();
  const health = useHealthCheck();

  useEffect(() => {
    const items = readHistory();
    setHistory(items);
    setSelected(items[0] ?? null);
    setHistoryReady(true);
  }, []);

  const currentCode = selected?.code ?? starterCode;
  const dependencies = useMemo(() => packageDependencies(currentCode), [currentCode]);
  const sandpackFiles = useMemo(() => ({
    '/App.js': { code: currentCode, active: true },
    '/index.js': { code: "import React from 'react';\nimport { createRoot } from 'react-dom/client';\nimport './styles.css';\nimport App from './App';\n\ncreateRoot(document.getElementById('root')).render(<App />);" },
    '/styles.css': { code: 'html, body, #root { min-height: 100%; margin: 0; }\nbody { font-family: ui-sans-serif, system-ui, sans-serif; }\n' },
    '/public/index.html': { code: '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><script src="https://cdn.tailwindcss.com"></script><title>ForgeSite preview</title></head><body><div id="root"></div></body></html>' },
  }), [currentCode]);
  const sandpackSetup = useMemo(() => ({ dependencies }), [dependencies]);

  function persist(items: Generation[]) {
    setHistory(items);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch { /* Storage may be unavailable. */ }
  }

  function generate() {
    const trimmed = prompt.trim();
    if (!trimmed || generation.isPending) return;
    setGenerationError('');
    generation.mutate({ data: { prompt: trimmed } }, {
      onSuccess: (result: { code: string }) => {
        const item: Generation = { id: crypto.randomUUID(), prompt: trimmed, code: result.code, createdAt: new Date().toISOString() };
        const next = [item, ...history].slice(0, 20);
        persist(next);
        setSelected(item);
        setPrompt('');
        setShowCode(false);
      },
      onError: (error: unknown) => setGenerationError(error instanceof Error ? error.message : 'Generation failed. Try again.'),
    });
  }

  function downloadZip() {
    if (!selected) return;
    const files = [
      { name: 'index.jsx', content: selected.code },
      { name: 'package.json', content: JSON.stringify({ name: 'forgesite-export', version: '1.0.0', private: true, dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1', ...packageDependencies(selected.code) } }, null, 2) },
      { name: 'README.md', content: `# ForgeSite export\n\nGenerated from the prompt:\n> ${selected.prompt}\n\n## Component\n\nThe generated React component is in \`index.jsx\`. Add it to a React application and install the dependencies listed in \`package.json\`.\n` },
    ];
    const url = URL.createObjectURL(makeZip(files));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'forgesite-website.zip';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(currentCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { setCopied(false); }
  }

  return (
    <main className="min-h-[100dvh] bg-[#0F172A] text-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-700/70 bg-[#0F172A]/95 backdrop-blur">
        <div className="mx-auto flex h-[68px] max-w-[1680px] items-center justify-between px-4 sm:px-7">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-[11px] bg-indigo-500 text-white shadow-[0_7px_20px_rgba(99,102,241,.26)]"><Flame size={19} strokeWidth={2.3} /></div>
            <div className="leading-none">
              <div className="text-[15px] font-bold tracking-[-.04em]">Forge<span className="text-indigo-300">Site</span></div>
              <div className="mt-1.5 text-[9px] font-semibold uppercase tracking-[.18em] text-slate-500">Prompt to preview</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 text-[11px] text-slate-400 sm:flex" data-testid="status-api">
              <span className={`h-1.5 w-1.5 rounded-full ${health.isError ? 'bg-rose-400' : health.isLoading ? 'bg-amber-300' : 'bg-emerald-400'}`} />
              {health.isError ? 'API unavailable' : health.isLoading ? 'Connecting' : 'Ready to build'}
            </div>
            <button type="button" onClick={downloadZip} disabled={!selected} data-testid="button-download-zip" className="inline-flex h-9 items-center gap-2 rounded-lg bg-indigo-500 px-3.5 text-xs font-semibold text-white transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-40 sm:px-4">
              <ArrowDownToLine size={15} /> <span>Download ZIP</span>
            </button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-[1680px] px-3 pb-6 pt-5 sm:px-7 sm:pt-7">
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div className="rise-in">
            <p className="mb-1.5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[.2em] text-indigo-300"><Sparkles size={12} /> Your creative workbench</p>
            <h1 className="text-[21px] font-semibold tracking-[-.035em] text-slate-50 sm:text-[25px]">Make the first version real.</h1>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-slate-500"><Monitor size={14} /><span>Responsive React preview</span></div>
        </div>

        <div className="grid min-h-[calc(100dvh-170px)] grid-cols-1 gap-4 lg:grid-cols-[2fr_3fr]">
          <aside className="flex min-h-[540px] flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-[#111c31] shadow-[0_22px_80px_rgba(2,6,23,.18)]">
            <div className="border-b border-slate-700/70 px-5 pb-4 pt-5">
              <div className="mb-4 flex items-center justify-between">
                <div className="flex items-center gap-2.5"><span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-500/15 text-indigo-300"><WandSparkles size={15} /></span><h2 className="text-sm font-semibold">Describe your site</h2></div>
                <span className="font-mono text-[10px] text-slate-500">01 / 01</span>
              </div>
              <label htmlFor="site-prompt" className="mb-2 block text-[11px] font-medium text-slate-300">What should we build?</label>
              <textarea id="site-prompt" data-testid="input-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') generate(); }} maxLength={4000} placeholder="A calm editorial portfolio for a ceramic artist, with a warm palette, oversized serif type, and a journal grid…" className="soft-scrollbar min-h-[147px] w-full resize-y rounded-xl border border-slate-700 bg-[#0d1729] px-3.5 py-3 text-[13px] leading-6 text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-indigo-400/80 focus:ring-2 focus:ring-indigo-500/15" />
              <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500"><span>Be clear about style, structure, and details.</span><span className="font-mono">{prompt.length}/4000</span></div>
              <button type="button" onClick={generate} disabled={!prompt.trim() || generation.isPending} data-testid="button-generate" className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-indigo-500 text-[13px] font-semibold text-white shadow-[0_8px_22px_rgba(99,102,241,.2)] transition hover:bg-indigo-400 disabled:cursor-not-allowed disabled:opacity-45">
                {generation.isPending ? <><LoaderCircle size={16} className="animate-spin" />Building your preview</> : <>Generate website <ArrowRight size={15} /></>}
              </button>
              {generationError && <div role="alert" className="mt-3 rounded-lg border border-rose-500/25 bg-rose-500/10 p-3 text-xs text-rose-200"><p>{generationError}</p><button type="button" onClick={generate} data-testid="button-retry-generation" className="mt-2 inline-flex items-center gap-1.5 font-semibold hover:text-white"><RotateCw size={12} /> Try again</button></div>}
              {generation.isPending && <div className="mt-3 space-y-2" aria-label="Generating website"><div className="h-2 animate-pulse rounded bg-slate-700/70" /><div className="h-2 w-4/5 animate-pulse rounded bg-slate-700/50" /></div>}
            </div>
            <div className="flex items-center justify-between px-5 pb-2 pt-5">
              <div className="flex items-center gap-2 text-[12px] font-semibold text-slate-200"><History size={14} className="text-indigo-300" /> Recent builds</div>
              <span className="rounded-md border border-slate-700 bg-slate-800/70 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">{history.length}</span>
            </div>
            <div className="soft-scrollbar flex-1 space-y-1.5 overflow-y-auto px-3 pb-3 pt-1">
              {!historyReady ? (
                <div className="space-y-2 p-2"><div className="h-12 animate-pulse rounded-xl bg-slate-800/80" /><div className="h-12 animate-pulse rounded-xl bg-slate-800/50" /></div>
              ) : history.length === 0 ? (
                <div className="workbench-grid mx-1 mt-2 rounded-xl border border-dashed border-slate-700 px-4 py-5 text-center">
                  <div className="mx-auto mb-2 grid h-8 w-8 place-items-center rounded-lg bg-slate-800 text-slate-400"><Clock3 size={15} /></div>
                  <p className="text-xs font-medium text-slate-300">Your builds will land here.</p><p className="mt-1 text-[10px] leading-4 text-slate-500">Generate a site to start your local history.</p>
                </div>
              ) : history.map((item) => (
                <button key={item.id} type="button" data-testid={`history-item-${item.id}`} onClick={() => { setSelected(item); setShowCode(false); setGenerationError(''); }} className={`group w-full rounded-xl border px-3 py-3 text-left transition ${selected?.id === item.id ? 'border-indigo-400/35 bg-indigo-500/10' : 'border-transparent hover:border-slate-700 hover:bg-slate-800/65'}`}>
                  <span className="mb-1.5 flex items-center justify-between gap-2"><span className={`truncate text-[11px] font-medium ${selected?.id === item.id ? 'text-indigo-100' : 'text-slate-300'}`}>{item.prompt}</span><ArrowRight size={12} className="shrink-0 text-slate-600 group-hover:text-indigo-300" /></span>
                  <span className="flex items-center gap-1.5 text-[10px] text-slate-500"><Clock3 size={10} />{formatDate(item.createdAt)}</span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2 border-t border-slate-700/70 px-5 py-3.5 text-[10px] text-slate-500"><Cpu size={12} /><span>History stays in this browser</span></div>
          </aside>

          <section className="flex min-h-[580px] flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-[#111c31] shadow-[0_22px_80px_rgba(2,6,23,.18)]">
            <div className="flex min-h-[57px] items-center justify-between gap-3 border-b border-slate-700/70 px-4 sm:px-5">
              <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,.1)]" /><h2 className="text-[12px] font-semibold text-slate-200">Live preview</h2><span className="hidden rounded border border-slate-700 px-1.5 py-0.5 font-mono text-[9px] text-slate-500 sm:inline">/</span></div>
              <div className="flex items-center gap-2">
                {selected && <span className="hidden max-w-[200px] truncate text-[10px] text-slate-500 md:inline">{selected.prompt}</span>}
                <button type="button" onClick={() => setShowCode(!showCode)} data-testid="button-show-code" className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition ${showCode ? 'border-indigo-400/40 bg-indigo-500/10 text-indigo-200' : 'border-slate-700 bg-slate-800/60 text-slate-300 hover:border-slate-600 hover:text-white'}`}><Code2 size={13} />{showCode ? 'Hide code' : 'Show code'}</button>
                {selected && <button type="button" onClick={copyCode} data-testid="button-copy-code" aria-label="Copy generated code" className="grid h-8 w-8 place-items-center rounded-lg border border-slate-700 bg-slate-800/60 text-slate-400 transition hover:text-white">{copied ? <Check size={14} /> : <Copy size={13} />}</button>}
              </div>
            </div>
            <div className="flex min-h-0 flex-1 flex-col bg-[#0d1729] p-2 sm:p-3">
              <div className={`relative min-h-[390px] flex-1 overflow-hidden rounded-xl border border-slate-700/80 bg-white ${showCode ? 'grid grid-rows-2' : ''}`}>
                <SandpackProvider template="react" theme="dark" files={sandpackFiles} customSetup={sandpackSetup} options={{ externalResources: ['https://cdn.tailwindcss.com'] }}>
                  <SandpackLayout className="!h-full !min-h-0 !flex-col !border-0 !rounded-none">
                    <div className={`${showCode ? 'h-full min-h-0' : 'h-full min-h-[390px]'} overflow-hidden`}>
                      <SandpackPreview showOpenInCodeSandbox={false} showRefreshButton />
                    </div>
                    {showCode && <div className="h-full min-h-0 overflow-hidden border-t border-slate-700"><SandpackCodeEditor showTabs showLineNumbers /></div>}
                  </SandpackLayout>
                </SandpackProvider>
                {!selected && <div className="pointer-events-none absolute bottom-3 right-3 flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white/90 px-2.5 py-1.5 text-[10px] font-medium text-slate-500 shadow-sm"><FileCode2 size={12} />Starter canvas</div>}
                {generation.isPending && <div className="absolute inset-0 z-10 grid place-items-center bg-[#f8fafc]/85 backdrop-blur-[2px]"><div className="w-[min(300px,85%)] rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"><div className="mb-4 flex items-center gap-3"><div className="grid h-9 w-9 place-items-center rounded-xl bg-indigo-50 text-indigo-600"><LoaderCircle size={18} className="animate-spin" /></div><div><p className="text-sm font-semibold text-slate-900">Building your idea</p><p className="mt-0.5 text-[11px] text-slate-500">Composing the page and styling.</p></div></div><div className="space-y-2"><div className="h-2 animate-pulse rounded bg-slate-100" /><div className="h-2 w-4/5 animate-pulse rounded bg-slate-100" /></div></div></div>}
                {generationError && selected && <div className="absolute bottom-4 left-4 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700"><ExternalLink size={12} />Previous preview is unchanged</div>}
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-slate-700/70 px-4 py-2.5 text-[10px] text-slate-500 sm:px-5">
              <span className="flex items-center gap-1.5"><span className="font-mono text-indigo-300">React</span><span>·</span><span>Tailwind ready</span></span>
              <span>{selected ? `Built ${formatDate(selected.createdAt)}` : 'Write a prompt to begin'}</span>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}
