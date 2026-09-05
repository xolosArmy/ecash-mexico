# eCash México

Sitio educativo de la comunidad xolosArmy Network en <https://ecash.mx/>.
HTML estático publicado con GitHub Pages; npm se utiliza para compilar assets y validar el sitio.

## Desarrollo

```sh
npm ci
npm run build
npm run lint
npm test
```

La compilación conserva las aplicaciones de onboarding, identidad y asamblea.
`tailwind.config.cjs` incluye las cinco áreas públicas para no eliminar sus clases.
No se requiere compilar la portada para servirla: sus estilos y su escena están versionados.

## Diseño y escena 3D

- `index.html` presenta primeros pasos, herramientas y comunidad, en ese orden.
- `blog/index.html` enlaza los 18 artículos existentes con el mismo diseño de tarjetas con profundidad.
- `assets/css/network.css` contiene los estilos adaptables de la portada y el archivo.
- `assets/js/network-scene.js` dibuja una red abstracta mediante WebGL nativo. Es decorativa; no representa cotizaciones ni actividad de red en vivo.
- La escena ofrece botones de giro y pausa, limita la resolución a 1.5 DPR y la animación a 30 fps. Detiene el bucle fuera de pantalla y en pestañas ocultas.
- Con movimiento reducido o ahorro de datos se dibuja un solo fotograma. Sin JavaScript, sin WebGL o ante un error gráfico se conserva una alternativa HTML. Los enlaces y el contenido nunca dependen del canvas.
- El contraste forzado usa la alternativa de texto. La navegación móvil permanece visible sin JavaScript.

## SEO

`scripts/site-pages.mjs` comparte las rutas entre el sitemap y el validador: portada, blog, onboarding, identidad y asamblea (23 páginas).
La validación comprueba títulos y descripciones únicos, un H1 por página, idioma, canonical, Open Graph, JSON-LD, referencias locales y concordancia exacta con el sitemap.

Los índices usan URLs con barra final. Las dos canónicas de artículos que apuntaban a rutas inexistentes ahora coinciden con sus archivos.
El sitemap omite `lastmod`: las fechas de un checkout no son fechas de modificación editorial.
Se mantienen Analytics y los destinos de las herramientas y de apoyo a la iniciativa.
Se retiraron las referencias a la imagen social y al logo de datos estructurados que no existen en el repositorio; la imagen social publicada respondía HTTP 404. Las tarjetas sociales usan título y descripción, sin inventar una imagen.

## Verificación

`npm test` ejecuta las pruebas de onboarding, identidad, asamblea y el ciclo de vida de la escena 3D.
Las pruebas de escena simulan las APIs gráficas para verificar pausa, movimiento reducido, visibilidad, errores y recuperación del contexto; no certifican el resultado visual ni el rendimiento de una GPU real.
El flujo existente de SEO CI también ejecuta Lighthouse con `lighthouserc.json`.

Para una revisión visual, servir el repositorio con `npm run serve` y comprobar la portada y el blog a 360, 768 y 1440 px, teclado, zoom de texto al 200%, movimiento reducido y un dispositivo con WebGL. No conectar una wallet ni firmar transacciones para revisar este rediseño.
