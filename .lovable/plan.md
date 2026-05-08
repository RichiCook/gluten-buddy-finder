
# App Nativa con Capacitor

## Cosa faremo nel progetto Lovable

1. **Installare le dipendenze Capacitor**: `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`, `@capacitor/android`
2. **Inizializzare Capacitor** con `npx cap init` e configurare `capacitor.config.ts` con:
   - App ID: `app.lovable.0a9c44974df2491eb68234391186be63`
   - App Name: `gluten-buddy-finder`
   - Hot-reload dal sandbox Lovable per sviluppo

## Cosa dovrai fare tu sul tuo computer

Dopo che avrò configurato il progetto, dovrai:

1. **Esportare su GitHub** tramite il pulsante "Export to GitHub" in Lovable
2. **Clonare il repo** sul tuo Mac (serve un Mac per iOS/App Store)
3. Eseguire questi comandi:
   ```
   npm install
   npx cap add ios
   npx cap update ios
   npm run build
   npx cap sync
   npx cap open ios
   ```
4. In **Xcode**: configurare il team di firma (serve un account Apple Developer, costa 99€/anno), impostare bundle ID, icone e splash screen
5. **Archiviare e caricare** su App Store Connect tramite Xcode
6. Compilare le informazioni richieste su [App Store Connect](https://appstoreconnect.apple.com): descrizione, screenshot, categoria, privacy policy

## Requisiti

- **Mac con Xcode** installato (ultima versione)
- **Account Apple Developer** (99€/anno) — [developer.apple.com](https://developer.apple.com)
- Per Google Play: Android Studio + account Google Play Console (25$ una tantum)

## Note

- Le modifiche al codice dell'app continueranno a essere fatte in Lovable
- Dopo ogni aggiornamento, basta fare `git pull` + `npx cap sync` + rebuild in Xcode
- Consiglio di leggere anche la guida Lovable: [Self-hosting e Capacitor](https://docs.lovable.dev/tips-tricks/self-hosting)
