# PIX Admin — Proceso de Deploy

Guía para publicar cambios del panel PIX Admin en producción.

- **Sitio en vivo:** https://pixadvisor.network/pix-admin/
- **Hosting:** GitHub Pages del repo `Ncamargo50/pixadvisor-website`, rama **`gh-pages`**.
- **Carpeta del repo en tu PC:** `D:\PIXADVISOR_AGENT_WORKSPACE\pixadvisor-website`
- **Lo que ve el cliente = lo que esté en la rama `gh-pages`.**

---

## 1. Flujo normal (editar → publicar)

Trabajá siempre en una **rama aparte**, nunca directo en `gh-pages`. Así producción no se toca hasta que vos decidís.

### a) Crear una rama de trabajo (una sola vez por tanda de cambios)
Abrí **Git Bash** en la carpeta y corré:

```bash
cd /d/PIXADVISOR_AGENT_WORKSPACE/pixadvisor-website
git checkout gh-pages
git pull origin gh-pages
git checkout -b fix/mi-cambio
```

### b) Hacer los cambios y commitear
Editá archivos dentro de `pix-admin/`. Después:

```bash
git add -A pix-admin/
git commit -m "descripción corta del cambio"
```

### c) IMPORTANTE — subir la versión del Service Worker (si tocaste HTML/JS/CSS)
Si no lo hacés, los navegadores siguen mostrando la versión vieja en caché.
En `pix-admin/sw.js`, subí el número de `CACHE_NAME`:

```
const CACHE_NAME = 'pix-admin-v3.4.0';   // → v3.4.1, v3.5.0, etc.
```

Volvé a commitear ese cambio (`git add pix-admin/sw.js && git commit -m "bump SW"`).

### d) Publicar (merge a producción + push)
```bash
git checkout gh-pages
git merge --ff-only fix/mi-cambio
git push origin gh-pages
```

Si `--ff-only` da error (porque gh-pages avanzó por otro lado), usá `git merge fix/mi-cambio` sin `--ff-only`.

En ~1–3 minutos GitHub Pages reconstruye y el sitio queda actualizado.

---

## 2. Verificar que quedó publicado

El CDN de GitHub cachea unos minutos. Para ver la versión real sin caché, agregá `?cb=` con cualquier número al final de la URL:

```bash
# ¿el build terminó?
gh api repos/Ncamargo50/pixadvisor-website/pages/builds/latest -q '.status'

# versión del Service Worker que se está sirviendo (debe ser la nueva)
curl -s "https://pixadvisor.network/pix-admin/sw.js?cb=123" | grep CACHE_NAME
```

En el navegador, si seguís viendo lo viejo: **Ctrl+Shift+R** (recarga forzada) o abrí en incógnito.

---

## 3. Notas importantes del panel

- **Login:** en el primer acceso pide **crear la contraseña de administrador** (pantalla "Configurar administrador"). Se guarda como hash PBKDF2 en el navegador. Ya NO existe el `pix/admin` público. Cada navegador/dispositivo tiene su propio usuario local.
- **Datos:** clientes, muestras y órdenes viven en IndexedDB del navegador (local). La sincronización con la nube (Supabase) trae los campos que cargan los técnicos con la app PIX Muestreo.
- **Supabase:** proyecto `fnoocboaupjmxpkhdnij`. Hay un workflow `supabase-keepalive` (en el repo `pix-admin`) que lo mantiene despierto cada 5 días. Si el panel muestra "Failed to fetch" en la sync, probablemente el proyecto se pausó: entrá al dashboard de Supabase y reactivalo.
- **NO depende de tu PC:** el panel es 100% estático + Supabase. Funciona aunque tu computadora esté apagada.

---

## 4. Estado / historia

- **2026-07-23:** publicada v3.4.0. Reconstruidos `cloud-sync.js` y `client-report.js` (estaban referenciados pero faltaban → daban 404). Seguridad: login PBKDF2 + first-run, CSP. Bugs de datos corregidos. PWA endurecida, íconos optimizados (1.95 MB → 4–33 KB). Auditoría completa de efectividad: las 13 funcionalidades verificadas producen entregables válidos.
- **Pendiente opcional:** el repo fuente `Ncamargo50/pix-admin` quedó en una versión vieja (v2.0). Producción corre desde `pixadvisor-website`. Para no volver a divergir, algún día conviene unificar y montar auto-deploy (necesita un token PAT).
