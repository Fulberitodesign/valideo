# Validéo

Suivi de projets vidéo pour monteurs : étapes validées des deux côtés (monteur et client), révisions avec commentaires au timecode ou à un endroit précis de l'image, facturation automatique en fin de projet, comptabilité et relances.

- Fonctionne **hors ligne** (données dans le navigateur, application installable).
- Se **synchronise en ligne** avec Supabase quand vous êtes connecté.
- Chaque client reçoit un **lien privé** vers son espace : il valide les étapes, commente les médias et consulte ses factures, sans créer de compte.
- Les fichiers d'un média (V1 jusqu'à la version finale) sont **supprimés automatiquement** X jours après sa validation (délai réglable).

## Structure

| Fichier | Rôle |
| --- | --- |
| `index.html` | Interface et styles |
| `app.js` | Application (local + synchro Supabase + espace client) |
| `config.js` | URL et clé publique (anon) du projet Supabase |
| `sw.js`, `manifest.webmanifest` | Mode hors ligne et installation |
| `supabase/schema.sql` | Tables, sécurité (RLS), fonctions de l'espace client, stockage |

## Mise en place

1. Dans Supabase > SQL Editor, exécutez `supabase/schema.sql`.
2. Renseignez `config.js` avec l'URL du projet et la clé `anon` (publique par conception, protégée par les règles RLS).
3. Dans Supabase > Authentication > URL Configuration, mettez l'adresse du site comme Site URL.
4. Publiez le dossier (GitHub Pages), ouvrez le site, créez votre compte dans « Identité & réglages ».
5. Ensuite, désactivez les nouvelles inscriptions (Authentication > Sign In / Providers) pour être le seul utilisateur.

Limite de l'offre gratuite Supabase : 50 Mo par fichier et 1 Go de stockage. Envoyez des versions de relecture légères (720p) ; les fichiers plus lourds restent sur votre appareil.
