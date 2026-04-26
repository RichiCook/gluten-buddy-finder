# Gluten Baby 

App che aiuta i celiaci a trovare prodotti senza glutine equivalenti a quello che fotografano (sia confezionati che piatti composti come "spaghetti alle vongole").

---

## 🎨 Design & UX

- **Stile**: mobile-first, pulito e amichevole, palette calda (verde/crema) che richiama natura e cibo sicuro. Tipografia leggibile, grandi tap target.
- **Logo/Header**: nome "Gluten Baby" con piccolo simbolo spiga sbarrata.
- **Navigazione bottom bar**: 📷 Scansiona · ⭐ Preferiti · 👤 Account (e 🛠️ Admin se utente è admin).

---

## 👤 Lato Utente

### 1. Home / Scansiona

- Pulsante grande "Scatta una foto" (apre camera del telefono) + opzione "Carica da galleria".
- Cronologia recente delle ultime scansioni.

### 2. Riconoscimento AI

- L'immagine viene inviata a una funzione backend che chiama **Lovable AI** (Gemini vision, gratuito incluso).
- L'AI restituisce:
  - Tipo: prodotto singolo *oppure* piatto composto.
  - Lista di "ingredienti glutinosi" identificati (es. `spaghetti`, `biscotti gocciole`, `pane`).
  - Nome leggibile del piatto/prodotto.

### 3. Schermata di conferma

- Mostra cosa l'AI ha riconosciuto (immagine + tag ingredienti).
- L'utente può:
  - ✅ Confermare
  - ✏️ Modificare (rimuovere/aggiungere ingredienti dalla lista)
  - 🔄 Rifare la foto

### 4. Risultati

- Per ogni ingrediente riconosciuto, l'app cerca nel DB i prodotti senza glutine "equivalenti" (matching per categoria + similarità nome+similarità visiva).
- Lista cards con: immagine, nome, brand, pulsante 🛒 "Acquista" (apre URL e-commerce) e ⭐ "Salva".

### 5. Preferiti

- Lista dei prodotti salvati. Richiede account.
- **Account**: registrazione email/password solo al momento del primo "Salva". Navigazione e ricerca restano libere senza login.

---

## 🛠️ Lato Admin

Pannello accessibile solo a utenti con ruolo `admin` (gestito tramite tabella ruoli separata, secondo best practice).

### Modalità 1 — Inserimento manuale

- Form: URL prodotto, nome, immagine (upload o URL), categoria (pasta / biscotti / pane / farina / dolci / altro).
- Possibilità di modificare/eliminare prodotti esistenti.

### Modalità 2 — Importazione da URL e-commerce (senza Firecrawl)

- Inserimento URL singolo prodotto → backend fa fetch HTML + parsing (Open Graph / meta tags / schema.org JSON-LD) per estrarre **nome, immagine, descrizione**. Admin conferma prima del salvataggio.
- Inserimento URL listing/categoria di un e-commerce senza glutine → il backend scarica la pagina, estrae tutti i link prodotto, e per ognuno tenta l'estrazione meta. Admin vede una tabella "candidati" e seleziona quali importare in batch.
- *Nota*: funziona bene per siti che espongono Open Graph (la maggior parte degli e-commerce). Per siti molto JS-heavy l'estrazione potrebbe fallire — in quel caso si ricade sull'inserimento manuale.

### Gestione utenti admin

- Pannello "Utenti" dove l'admin principale può promuovere altri utenti a admin.

---

## 🗄️ Dati & Backend (Lovable Cloud)

- **Tabelle**:
  - `profiles` — info utente
  - `user_roles` — gestione ruoli (user/admin), tabella separata per sicurezza
  - `products` — catalogo: nome, immagine, url, categoria, tag ingredienti, brand
  - `favorites` — prodotti salvati per utente
  - `scans` — cronologia scansioni utente
- **Storage**: bucket per immagini prodotti caricate manualmente.
- **Edge functions**:
  - `recognize-image` — invia foto a Lovable AI (vision) e restituisce ingredienti
  - `extract-product-url` — fetch + parsing meta tags di un URL prodotto
  - `extract-product-list` — fetch pagina listing + estrazione candidati prodotto
  - `match-products` — cerca nel DB i prodotti senza glutine corrispondenti
- **AI**: Lovable AI (Gemini 3 Flash con vision) — nessuna chiave da configurare.

---

## 📦 Prima versione (cosa costruiamo subito)

1. Setup Lovable Cloud + auth + tabella ruoli admin.
2. Schema DB prodotti + storage immagini.
3. Flusso utente: camera → riconoscimento AI → conferma → risultati → preferiti.
4. Pannello admin: CRUD prodotti manuale + importazione da URL singolo (meta tags).
5. Importazione listing batch da URL categoria.
6. Seed iniziale con qualche prodotto demo per testare il matching.

Dopo l'approvazione passo in modalità build e inizio a costruire. 🚀