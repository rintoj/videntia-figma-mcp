import * as http from "http";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";

export interface FileMap {
  [filePath: string]: string;
}

export interface SandpackServerResult {
  url: string;
  stop: () => void;
}

export async function startSandpackServer(
  files: FileMap,
  entry: string
): Promise<SandpackServerResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "figma-compare-"));

  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(tmpDir, filePath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  const entryContent = files[entry] ?? "";
  const indexHtml = buildIndexHtml(entryContent, entry, files);
  fs.writeFileSync(path.join(tmpDir, "index.html"), indexHtml);

  const server = http.createServer((req, res) => {
    const filePath = path.join(tmpDir, req.url === "/" ? "/index.html" : req.url!);
    if (fs.existsSync(filePath)) {
      const ext = path.extname(filePath);
      const mimeTypes: Record<string, string> = {
        ".html": "text/html",
        ".js": "application/javascript",
        ".ts": "application/javascript",
        ".tsx": "application/javascript",
        ".css": "text/css",
      };
      res.writeHead(200, { "Content-Type": mimeTypes[ext] ?? "text/plain" });
      res.end(fs.readFileSync(filePath));
    } else {
      res.writeHead(404);
      res.end("Not found");
    }
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;

  return {
    url: `http://127.0.0.1:${port}`,
    stop: () => {
      server.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

function buildIndexHtml(entryContent: string, entry: string, files: FileMap): string {
  const imports: Record<string, string> = {
    react: "https://esm.sh/react@18",
    "react-dom": "https://esm.sh/react-dom@18",
    "react-dom/client": "https://esm.sh/react-dom@18/client",
  };

  for (const filePath of Object.keys(files)) {
    imports[filePath.replace(/^\//, "./")] = filePath;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <script type="importmap">${JSON.stringify({ imports })}</script>
  <script src="https://esm.sh/tsx@4/dist/esm/browser.js" type="module"></script>
</head>
<body>
  <div id="root"></div>
  <script type="text/tsx">
    import React from "react";
    import { createRoot } from "react-dom/client";
    ${entryContent}
    createRoot(document.getElementById("root")).render(React.createElement(App));
  </script>
</body>
</html>`;
}
