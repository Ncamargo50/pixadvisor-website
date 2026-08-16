# CLAUDE.md — Pixadvisor Website

Sitio **estático bilingüe (ES/PT)** de Pixadvisor — agricultura de precisión, Bolivia y Brasil.
HTML/CSS/JS vanilla, sin build. PWA con Service Worker.

> Este archivo se publica en la web (GitHub Pages sirve la raíz). **No poner aquí secretos,
> credenciales, ni detalles de vulnerabilidades.** Esas notas van fuera del repo.

## Deploy (IMPORTANTE)
- **Producción = rama `gh-pages`** (raíz). GitHub Pages sirve desde ahí en https://pixadvisor.network (CNAME).
- `master` está desactualizado y **NO** es producción. No desplegar desde ahí.
- Publicar: trabajar en una rama de feature → `git checkout gh-pages && git merge <rama> && git push origin gh-pages`. Pages reconstruye en ~1-2 min.
- **Tras cambiar cualquier asset (css/js/img), bumpear `CACHE_NAME` en `sw.js`** (`'pixadvisor-vN'`), o el Service Worker sigue sirviendo la versión vieja.
- **`_headers` es formato Netlify/Cloudflare y GitHub Pages LO IGNORA.** Las cabeceras de seguridad reales (HSTS, `frame-ancestors`, `nosniff`) requieren Cloudflare como proxy. `frame-ancestors` NO funciona por `<meta http-equiv>` (solo como cabecera real) — no ponerlo en el meta CSP (genera error de consola).

## Estructura
- `index.html` — home monolítica: CSS en `css/main.css`, JS **inline al final del body**.
- `css/main.css` — sistema de diseño (tokens en `:root`).
- `servicios/*.html` — 11 páginas de servicio + `servicios/styles.css` (comparten tokens/estilo con la home).
- `img/` — assets; **servir siempre `.webp`**.
- `pix-admin/`, `pix-muestreo/` — subapps aparte (tienen su propio deploy/lógica; no tocarlas al trabajar la web pública).

## Marca / Diseño
- Paleta: **teal `#0D9488` · lima `#7FD633` · azul `#1E40AF`**. Fondo oscuro `#0F172A`.
- Texto teal **accesible**: `#0A6E65` (`--primary-text`). Regla: `--primary` para **fondos/bordes**, `--primary-text` para **texto/enlaces sobre claro**.
- Tipografía: **Sora** (títulos) + **Public Sans** (cuerpo). **No Inter/Open Sans.** Cargar con `media="print" onload` + preconnect.
- Contraste mínimo **WCAG AA** (4.5:1 texto normal, 3:1 grande/UI). Verificar antes de mergear.
- **Evitar "tells" de UI generada por IA**: nada de barras de acento laterales (`border-left`) en tarjetas, ni texto con degradado (`background-clip:text`). Usar bordes cohesivos + subrayado de degradado corto para acentos.

## Convenciones de código
- **Bilingüe**: cada texto en `<span data-lang-es>…</span><span data-lang-pt>…</span>`. El CSS oculta el idioma inactivo (`[data-lang-pt]{display:none}`; `html[lang="pt"]` invierte). El conmutador solo cambia `document.documentElement.lang` (+ título de pestaña + `localStorage`).
- Español **boliviano**: "soya" (no "soja").
- **Fallback sin JS**: el contenido `.fade-in` solo se oculta bajo la clase `.js` (se agrega en `<head>` por JS). Nunca dejar la página en blanco si el JS no corre.
- **Canonical/`og:url`/JSON-LD `url`** de servicios: `https://pixadvisor.network/servicios/<archivo>.html` (SIN `/img/`).
- Imágenes con `width`+`height` (evitar CLS), `loading="lazy"` (salvo logo/above-the-fold), `decoding="async"`.

## Imágenes (reglas duras)
- **Servir `.webp`**; redimensionar a ~2× el tamaño de display (no subir 4000px para mostrar a 400px).
- **Prohibido texto en portugués incrustado** en imágenes que se muestran en ES → traducir dentro del archivo.
- **Prohibidas marcas de agua de terceros** → quitarlas.
- **Mapas con datos/leyendas/banners incrustados**: usar `object-fit: contain` (no `cover`, que recorta el texto). Como sus márgenes suelen ser blancos, `contain` sobre `#fff` se funde sin bordes.

## Trampas conocidas (no repetir)
- **No** usar `content-visibility:auto` con `contain-intrinsic-size` fijo en secciones altas: hace fluctuar la altura del documento al hacer scroll y deja una **franja blanca** al final.
- El logo real ocupaba solo ~40% del PNG (resto padding transparente): recortar al contenido antes de mostrar, o se ve diminuto.
- El menú móvil debe restaurar `body.overflow` y `aria-expanded` al cerrarse por cualquier vía (usar una función `closeMobileNav()` central).
- El `<meta http-equiv>` CSP debe mantener sincronizado el whitelist con lo que usa el sitio (GA4, Clarity, fonts, wa.me).
