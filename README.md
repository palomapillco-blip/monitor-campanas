# Monitor de campañas · Ecommerce Perú

Captura todos los días la home de los principales ecommerce peruanos (Cyber Wow, Black Friday, Navidad…),
detecta ofertas y mecánicas comerciales con reglas + OCR, compara con el día anterior y publica un dashboard
web que se actualiza solo. Todo corre gratis en GitHub Actions + GitHub Pages.

## Cómo funciona

1. `src/monitor.js` abre cada home una vez con Playwright (Chromium headless, 1440×900, `es-PE`, `America/Lima`).
2. Cierra pop-ups y banners de cookies, espera la carga y hace scroll lento para disparar el lazy load.
3. Guarda `screenshots/AAAA-MM-DD/<id>-hero.jpg` (primera pantalla) y `<id>-full.jpg` (página completa, máx. 4000 px), JPG calidad 70.
4. Extrae texto visible, `alt` de imágenes y textos de banners/carruseles, y pasa OCR (tesseract.js, `spa`) al hero.
5. `src/signals.js` detecta señales: campaña, descuentos, tarjeta propia, bancos, cuotas sin intereses, cupones
   (con monto y ticket mínimo), multicompra, urgencia, envío/retiro gratis y categorías destacadas.
6. Compara con el último día guardado y marca qué es nuevo y qué desapareció.
7. Escribe `data/AAAA-MM-DD.json` y `data/index.json`, que es lo que lee el dashboard (`index.html`).

## Uso local

```bash
npm install
npx playwright install chromium
npm run monitor                          # todos los sitios
npm run monitor -- --only ripley,wong    # solo algunos (se mezclan con lo ya capturado hoy)
npm run serve                            # dashboard en http://localhost:8080
npm run test:signals                     # prueba rápida de las reglas
```

## Agregar o quitar tiendas

Edita `sites.json`. Cada tienda necesita `id` (sin espacios, se usa en nombres de archivo), `name` y `url`.
Para pausar una sin borrarla agrega `"enabled": false`. En `settings` están el viewport, la calidad JPG,
la altura máxima de la captura completa y cuántos días de capturas se guardan (`keepScreenshotsDays`).

Las palabras clave (tarjetas, bancos, campañas, categorías, urgencia) están al inicio de `src/signals.js`.

## Publicar gratis (GitHub Actions + Pages)

1. Crea un repositorio **público** en GitHub (Pages es gratis en repos públicos) y sube esta carpeta.
2. En el repo: **Actions** → habilita los workflows → abre "Monitor diario" → **Run workflow** para la primera corrida.
3. Cuando termine, ve a **Settings → Pages** → *Source: Deploy from a branch* → rama `gh-pages`, carpeta `/ (root)`.
4. El dashboard queda en `https://<usuario>.github.io/<repo>/`. Ese link es el que compartes.

La captura diaria la hace el Mac a las 7:00 a. m. (ver abajo): las corridas programadas de GitHub salen con horas
de atraso, así que quedan de respaldo. Corren a las 7:30, 9:15 y 11:10 a. m. (Lima), o cuando GitHub las largue, y solo
capturan las tiendas que ese día falten o no estén en OK; si no falta ninguna, no hacen nada. **Run workflow** siempre
captura todas las de GitHub. Un cambio del dashboard (`index.html`, `assets/`) subido a `main` se publica solo, sin capturar.

Los datos y capturas se guardan en la rama `gh-pages` como un único commit, así el repo no crece con las imágenes;
las capturas de más de `keepScreenshotsDays` días se borran, los JSON se conservan siempre. Para cambiar las horas edita
los `cron` en `.github/workflows/monitor.yml` (están en UTC: Lima = UTC−5).

## Captura diaria desde el Mac

Una tarea diaria en el Mac captura todas las tiendas y las publica en la rama `gh-pages`. Antes de capturar se
actualiza desde `main` (`git pull --ff-only`), así que una tienda o palabra clave nueva entra en la corrida del día
siguiente sin tocar el Mac. Si la carpeta del Mac tiene cambios sin subir que chocan con `main`, avisa en el log y
sigue con lo que hay.

Algunos sitios bloquean las visitas desde los servidores de GitHub (Ripley responde con la verificación de
Cloudflare; La Curacao y Efe con 426 y Platanitos con 403). Esos llevan `"runner": "local"` en `sites.json`: solo
los captura el Mac, y las corridas de GitHub los saltan. `src/publish.js` mezcla por tienda, así que el Mac y GitHub
no se pisan: una captura con problemas no reemplaza a una buena del mismo día, y reintenta si las dos corridas coinciden.

```bash
./scripts/install-mac-schedule.sh          # instala la tarea diaria (7:00 a. m.; otra hora: 06:30)
launchctl kickstart gui/$(id -u)/pe.monitor-campanas.local   # correrla ahora
tail -f .cache/local-run.log               # ver qué pasó
./scripts/install-mac-schedule.sh --uninstall
npm run monitor:local                      # lo mismo, a mano
```

Si el Mac está dormido a esa hora, también con la tapa cerrada, la tarea arranca en su siguiente despertar (hasta unos
15 minutos después) y `caffeinate -s` lo mantiene despierto hasta que termina. Eso solo funciona **enchufado**: a batería
y con la tapa cerrada, la corrida puede tardar más de una hora. Si está apagado todo el día, las corridas de respaldo
de GitHub capturan las demás tiendas, pero las de `"runner": "local"` ese día no aparecen. La tarea usa la ruta de `node` del momento de instalarla: si cambias de versión con nvm, vuelve a correr
el instalador.

## Monitor de anuncios (Meta y Google)

`anuncios.html` (enlazado desde el dashboard) muestra los anuncios de la competencia de una campaña en
**Meta Ad Library** y **Google Ads Transparency Center**, en tres pestañas: Meta, Google y Meta vs Google. Marca como
**Nuevo** lo que no estaba el día anterior. Se configura en `anuncios.json`:

- `settings`:
  - `campaign`: nombre de la campaña.
  - `keyword`: palabra clave, por ejemplo `cyber`.
  - `startDate` / `endDate`: la ventana de la campaña.
- `brands`: cada marca con su `metaPageId` (el número `view_all_page_id` de la URL del anunciante en el Ad Library)
  y su `googleDomain` (por ejemplo `ripley.com.pe`).

`src/anuncios.js` hace dos cosas:

- **Meta:** abre el Ad Library de cada marca con Playwright, recorre la lista ("Ver más") y se queda con los anuncios
  activos cuyo texto contiene la palabra clave.
- **Google:** consulta el centro de transparencia sin navegador y toma los anuncios mostrados por primera vez desde
  `startDate`. De los nuevos lee el titular y la descripción. A los banners sin texto les pasa OCR: si encuentra la
  palabra clave quedan **Sí**, si no, **Por revisar**.

Guarda miniaturas propias en `anuncios/img/` (los links de imagen de Meta caducan en días) y el día en
`anuncios/data/AAAA-MM-DD.json`.

```bash
npm run anuncios                              # todas las marcas, Meta y Google
npm run anuncios -- --only ripley,wong        # solo algunas marcas
npm run anuncios -- --source google           # solo una fuente
npm run anuncios:publish -- --from .          # publicar una corrida local en gh-pages
```

- **Corrida diaria:** la del Mac (`npm run monitor:local`) también captura y publica los anuncios. El workflow
  **Anuncios diario** es el respaldo, a las 8:45 a. m. Meta suele bloquear a los servidores de GitHub; cuando eso pasa,
  `src/anuncios-publish.js` conserva lo que publicó el Mac (mezcla por marca y fuente, igual que `publish.js`).
- **Corregir la clasificación de Google:** agrega `"<link del anuncio>": "Sí"` o `"No"` en `anuncios-revision.json`.
  Se aplica en la siguiente corrida.
- **Límite:** las bibliotecas no publican inversión ni impresiones de anuncios comerciales en Perú.

## Descargas

El botón **Descargar** del dashboard ofrece dos archivos:

- **Excel** (`data/monitor-campanas.xlsx`): todo el historial, con la pestaña **Tiendas por día** (una fila por tienda
  y día) y **Cambios** (una fila por cada mecánica que apareció o salió). Lo genera `src/build-index.js` cada vez
  que se publica, con las mismas columnas que la hoja de Google Sheets de abajo.
- **Reporte del día**: el día que estás viendo en un solo archivo HTML (unos 2 MB) con el resumen, los cambios y cada
  tienda con su captura incrustada. Se puede mandar por WhatsApp o correo, abrir sin internet, o imprimir como PDF.

## Google Sheets

`apps-script/sheets-sync.gs` copia los datos publicados a una hoja de cálculo, sin hacer scraping:
la pestaña **Tiendas por día** tiene una fila por tienda y día, y **Cambios**, una fila por cada mecánica que apareció o salió.

1. Crea una hoja nueva en Google Sheets → **Extensiones → Apps Script**.
2. Reemplaza todo el contenido de `Código.gs` por el de `apps-script/sheets-sync.gs` y guarda.
3. Arriba, elige la función **instalar** y presiona **Ejecutar**. Google pide permiso para leer la web y editar
   esa hoja (si sale “Google no verificó esta app”, es porque el script es tuyo: *Configuración avanzada → Ir a…*).

Trae todo el historial y revisa cada hora si hay datos nuevos. Si un día se vuelve a publicar (el Mac sube todo y
después GitHub completa alguna tienda), sus filas se reemplazan, no se duplican. Esas dos pestañas se reescriben en cada
sincronización: las fórmulas, tablas dinámicas o notas propias van en otra pestaña.

## Limitaciones a tener en cuenta

- GitHub Actions corre desde servidores en EE. UU. Algunos sitios pueden bloquear la visita o mostrar otra versión;
  el dashboard marca esos casos como **Bloqueado** / **Parcial** y no los usa para comparar.
- El OCR de banners con tipografías de campaña no es perfecto: la captura siempre está a un clic para verificar.
- Los badges de descuento de cada producto (“-58%”) se resumen aparte (cantidad y máximo) para que la comparación diaria
  muestre cambios de mecánicas y no de productos.
- GitHub pausa los workflows programados tras 60 días sin actividad en el repo; si pasa, reactívalo desde Actions.
