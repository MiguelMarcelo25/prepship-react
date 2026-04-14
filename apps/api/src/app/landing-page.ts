/**
 * Landing page handler for GET /.
 * Returns a small self-contained HTML page so visitors who type the API URL
 * in a browser see something useful instead of `{"error":"Not found"}`.
 */

export function renderLandingPage(): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PrepShip v2 API</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      line-height: 1.5;
    }
    .card {
      max-width: 640px;
      width: 100%;
      background: #1e293b;
      border-radius: 14px;
      padding: 2.5rem;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
      border: 1px solid #334155;
    }
    h1 {
      font-size: 1.75rem;
      margin-bottom: 0.25rem;
      color: #f1f5f9;
    }
    .tag {
      display: inline-block;
      font-size: 0.75rem;
      background: #10b981;
      color: #022c22;
      padding: 0.2rem 0.6rem;
      border-radius: 999px;
      font-weight: 600;
      margin-left: 0.5rem;
      vertical-align: middle;
    }
    .subtitle {
      color: #94a3b8;
      margin-bottom: 1.5rem;
      font-size: 0.95rem;
    }
    h2 {
      font-size: 0.85rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
      margin: 1.5rem 0 0.75rem;
      font-weight: 600;
    }
    .links {
      display: grid;
      grid-template-columns: 1fr;
      gap: 0.5rem;
    }
    a {
      display: block;
      padding: 0.75rem 1rem;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      color: #e2e8f0;
      text-decoration: none;
      font-size: 0.9rem;
      transition: all 0.15s;
    }
    a:hover {
      background: #334155;
      border-color: #475569;
      color: #ffffff;
    }
    a .path { color: #94a3b8; font-family: "SFMono-Regular", Consolas, monospace; }
    a.primary { background: #2563eb; border-color: #3b82f6; color: #ffffff; }
    a.primary:hover { background: #1d4ed8; }
    .endpoints {
      font-family: "SFMono-Regular", Consolas, monospace;
      font-size: 0.82rem;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 1rem;
      color: #94a3b8;
    }
    .endpoints span { color: #10b981; }
    .endpoints code { color: #cbd5e1; }
    footer {
      margin-top: 2rem;
      padding-top: 1.5rem;
      border-top: 1px solid #334155;
      font-size: 0.75rem;
      color: #64748b;
      text-align: center;
    }
    footer code { background: #0f172a; padding: 0.1rem 0.4rem; border-radius: 4px; color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>PrepShip v2 API <span class="tag">LIVE</span></h1>
    <p class="subtitle">Node + PostgreSQL backend deployed on Render, Singapore region.</p>

    <h2>Quick links</h2>
    <div class="links">
      <a class="primary" href="https://prepship-react-react.vercel.app" target="_blank" rel="noopener">
        → Open the React app (Vercel frontend)
      </a>
      <a href="/health">
        <strong>/health</strong> <span class="path">— check if the API is up</span>
      </a>
    </div>

    <h2>Available endpoints</h2>
    <div class="endpoints">
      <div><span>GET</span> <code>/health</code></div>
      <div><span>GET</span> <code>/api/clients</code></div>
      <div><span>GET</span> <code>/api/orders?orderStatus=awaiting_shipment</code></div>
      <div><span>GET</span> <code>/api/orders/:id</code></div>
      <div><span>GET</span> <code>/api/locations</code></div>
      <div><span>GET</span> <code>/api/shipments/status</code></div>
      <div><span>GET</span> <code>/api/stores</code></div>
      <div><span>GET</span> <code>/api/carriers</code></div>
      <div><span>GET</span> <code>/api/orders/daily-stats</code></div>
      <div style="margin-top: 0.5rem; color: #64748b;">
        All <code>/api/*</code> routes require <code>X-App-Token</code> header
      </div>
    </div>

    <footer>
      Stack: Node 22+ · PostgreSQL 17.6 · Render · Supabase<br />
      Try: <code>curl -H "X-App-Token: &lt;token&gt;" https://prepship-api.onrender.com/api/clients</code>
    </footer>
  </div>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=60",
    },
  });
}
