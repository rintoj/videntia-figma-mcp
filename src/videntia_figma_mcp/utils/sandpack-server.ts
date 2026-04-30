export interface FileMap {
  [filePath: string]: string;
}

export interface SandpackServerResult {
  url: string;
  stop: () => void;
}

const COMMON_CDN_PACKAGES: Record<string, string> = {
  react: "https://esm.sh/react@18",
  "react-dom": "https://esm.sh/react-dom@18",
  "react-dom/client": "https://esm.sh/react-dom@18/client",
  "react/jsx-runtime": "https://esm.sh/react@18/jsx-runtime",
};

export async function startSandpackServer(files: FileMap, entry: string): Promise<SandpackServerResult> {
  const transpiler = new Bun.Transpiler({
    loader: "tsx",
    target: "browser",
    tsconfig: {
      compilerOptions: {
        jsx: "react",
        jsxFactory: "React.createElement",
        jsxFragmentFactory: "React.Fragment",
      },
    },
  });

  // Detect npm packages imported across all files
  const npmImports = { ...COMMON_CDN_PACKAGES };
  for (const content of Object.values(files)) {
    for (const match of content.matchAll(/from\s+["']([^./][^"']*)['"]/g)) {
      const pkg = match[1];
      if (!npmImports[pkg]) {
        npmImports[pkg] = `https://esm.sh/${pkg}`;
      }
    }
  }

  const indexHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <script type="importmap">${JSON.stringify({ imports: npmImports })}</script>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    import React from "react";
    import { createRoot } from "react-dom/client";
    import App from "${entry}";
    createRoot(document.getElementById("root")).render(React.createElement(App));
  </script>
</body>
</html>`;

  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/") {
        return new Response(indexHtml, { headers: { "Content-Type": "text/html" } });
      }

      // Try exact path, then with tsx/ts extension
      const candidates = [
        url.pathname,
        url.pathname + ".tsx",
        url.pathname + ".ts",
        url.pathname + ".jsx",
        url.pathname + ".js",
      ];
      const filePath = candidates.find((p) => files[p]);
      if (filePath) {
        const js = transpiler.transformSync(files[filePath]);
        return new Response(js, { headers: { "Content-Type": "application/javascript" } });
      }

      return new Response("Not found", { status: 404 });
    },
  });

  return {
    url: `http://127.0.0.1:${server.port}`,
    stop: () => server.stop(),
  };
}
