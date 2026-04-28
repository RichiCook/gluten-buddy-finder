## Obiettivo

Usare l'immagine del topolino caricata (`Harvest_Mouse.-Wiki-Commons.jpg`) come simbolo/logo dell'app, sostituendo il logo attuale.

## Modifiche

1. **Copia dell'immagine**
   - Copiare `user-uploads://Harvest_Mouse.-Wiki-Commons.jpg` in `src/assets/logo.png` (sovrascrivendo il logo attuale).
   - Così tutti i punti del codice che già importano `@/assets/logo.png` (header in `src/components/AppLayout.tsx`) prendono automaticamente il nuovo simbolo, senza altre modifiche al codice.

2. **Favicon del browser**
   - Generare una versione quadrata 256×256 dell'immagine del topolino e salvarla come `public/favicon.ico`, in modo che anche la tab del browser mostri il nuovo simbolo.

3. **Verifica**
   - Nessuna modifica di logica o componenti React. Il logo nell'header resterà visualizzato come `h-9 w-9` (cerchio piccolo) — l'immagine verrà ritagliata centralmente per restare leggibile a quella dimensione.

## Nota

L'immagine originale è una foto naturale (sfondo verde sfocato). A quella dimensione (36×36 px nell'header) si vedrà il topolino ma con un piccolo bordo verde. Se in futuro vorrai un logo "pulito" con sfondo trasparente o stilizzato (icona vettoriale), posso generarne una versione dedicata: fammi sapere se preferisci procedere così oppure se vuoi prima una versione ritagliata/stilizzata.