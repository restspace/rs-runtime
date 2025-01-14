
// NOTE As is does not support reference to other files in the same Restspace instance except with full urls
import { transform } from "https://esm.sh/sucrase@3.30.0";
import { default as preactRenderToString } from "https://esm.sh/preact-render-to-string@5.2.4";
import { LRUCache } from "rs-core/utility/LRUCache.ts";

// Our default LRU cache size in bytes. Adjust to your needs:
const MAX_CACHE_SIZE = 1_000_000; // 1 MB

// A shared cache instance
const compiledTemplatesCache = new LRUCache(MAX_CACHE_SIZE);

interface RenderOptions {
  data: Record<string, unknown>; // props to pass into the component
  template: string;             // the JSX code
  templateId: string;           // a unique key to identify/cache this template
}

/**
 * renderJsxWithCache
 * 1) Checks the LRU cache for a compiled module by templateId.
 * 2) If not found, uses Sucrase to compile the JSX => JS.
 * 3) Dynamically imports the compiled module (blob URL).
 * 4) Renders the module’s default export (assumed to be a Preact component) to an HTML string.
 */
// export async function renderJsxWithCache({ data, template, templateId }: RenderOptions): Promise<string> {
//   // 1) Check cache
//   let cached = compiledTemplatesCache.get(templateId) as {
//     component: any;     // the default-exported Preact component
//     moduleUrl: string;  // the blob: URL from dynamic import
//   } | undefined;

//   // 2) If not in cache, compile + import
//   if (!cached) {
//     // a) Transform the JSX string with Sucrase
//     //    We pass { jsxPragma: "h" } because we’re using Preact with the classic runtime,
//     //    so <div> -> h("div", ...).
//     const { code: transpiledCode } = transform(template, {
//       transforms: ["jsx"], // or ["jsx", "typescript"] if TSX
//       jsxPragma: "h",
//     });

//     // b) Convert transpiled code to a blob: URL
//     const blob = new Blob([transpiledCode], { type: "application/javascript" });
//     const moduleUrl = URL.createObjectURL(blob);

//     // c) Dynamically import the module
//     const mod = await import(moduleUrl);

//     // d) Prepare an eviction callback to revoke the blob URL
//     const onEvict = () => {
//       URL.revokeObjectURL(moduleUrl);
//     };

//     // e) Store in our LRU cache
//     const approximateSize = new TextEncoder().encode(transpiledCode).length;
//     cached = { component: mod.default, moduleUrl };
//     compiledTemplatesCache.set(templateId, {
//       size: approximateSize,
//       data: cached,
//       onEvict,
//     });
//   }

//   // 3) The compiled module should have a default export that is a Preact component
//   const Component = cached.component;
//   if (typeof Component !== "function") {
//     throw new Error(`Template ${templateId} does not export a default Preact component!`);
//   }

//   // 4) Render to string via preact-render-to-string
//   //    (imported as `preactRenderToString`).
//   //
//   //    We must pass a "VNode" to it—i.e. `h(Component, props)`.
//   //    This is effectively SSR for Preact.
//   const { h } = await import("https://esm.sh/preact@10.13.2"); 
//   const html = preactRenderToString(h(Component, data));

//   return html;
// }
